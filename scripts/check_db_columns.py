"""检查前端写入的数据库字段是否真实存在。

背景：PostgREST 会把客户端 insert/update 里出现的字段当成真实列去解析。
如果代码往一张表里写了库里没有的列（例如 hb_candidates 并不存在
confidence / skills 这两列），请求会直接失败：
  Could not find the 'confidence' column of 'hb_candidates' in the schema cache

本脚本拿 scripts/db_columns.json（云端表结构快照）与 src/ 下所有
.from('hb_*').insert/update/upsert() 的字段做比对，发现不存在的列就退出码 1。

用法：
  python scripts/check_db_columns.py              # 检查 src/services.js + src/App.jsx
  python scripts/check_db_columns.py src/xxx.js   # 指定文件

注意：db_columns.json 是云端表结构快照。新增/删除列后请同步更新该文件。
"""
import os
import re
import sys
import json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DB = json.load(open(os.path.join(HERE, 'db_columns.json'), encoding='utf-8'))
COLS = {name: set(info['cols'].split(',')) for name, info in DB.items()}

WRITE_CALL = re.compile(r"\.from\('(hb_[a-z_]+)'\)\s*\.\s*(insert|update|upsert)\s*\(")


def find_object(text, start):
    """start 指向 '{'，返回对象字面量内容与结束位置（跳过字符串与注释）。"""
    depth = 0
    i = start
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in '\'"`':
            quote = ch
            i += 1
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == quote:
                    break
                i += 1
        elif ch == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                i += 1
        elif ch == '/' and i + 1 < n and text[i + 1] == '*':
            i = text.find('*/', i)
            i = n if i < 0 else i + 1
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i
        i += 1
    return None, n


def top_keys(body):
    """提取对象字面量顶层的 key（嵌套对象内部的 key 不算）。

    需要区分「键: 值」和三元表达式里的冒号，例如
        pass_score: x == null ? null : Number(x)
    这里的第二个 null 是值，不是键。做法是跟踪三元表达式的嵌套层数：
    遇到 ? 记一层，遇到对应的 : 消一层，并把紧跟其后的标识符标记为值。
    """
    keys = []
    depth = 0
    ternary = 0
    skip_ident = False
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        skip = skip_ident
        if ch in '\'"`':
            skip_ident = False
            quote = ch
            j = i + 1
            while j < n:
                if body[j] == '\\':
                    j += 2
                    continue
                if body[j] == quote:
                    break
                j += 1
            if depth == 0:
                k = j + 1
                while k < n and body[k] in ' \t\n':
                    k += 1
                if k < n and body[k] == ':' and not skip:
                    keys.append(body[i + 1:j])
            i = j
        elif ch in '{([':
            skip_ident = False
            depth += 1
        elif ch in '})]':
            skip_ident = False
            depth -= 1
        elif depth == 0 and ch == '?':
            ternary += 1
            skip_ident = True
        elif depth == 0 and ch == ':':
            if ternary > 0:
                ternary -= 1
                skip_ident = True
                i += 1
                continue
            skip_ident = False
        elif depth == 0 and (ch.isalpha() or ch == '_'):
            skip_ident = False
            j = i
            while j < n and (body[j].isalnum() or body[j] in '_$'):
                j += 1
            k = j
            while k < n and body[k] in ' \t\n':
                k += 1
            if k < n and body[k] == ':' and not skip:
                keys.append(body[i:j])
            i = j
        i += 1
    return keys


def top_spreads(body):
    """提取对象体顶层被展开的变量名（形如 ...base）。"""
    names = []
    depth = 0
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        if ch in '\'"`':
            quote = ch
            j = i + 1
            while j < n:
                if body[j] == '\\':
                    j += 2
                    continue
                if body[j] == quote:
                    break
                j += 1
            i = j
            continue
        if ch in '{([':
            depth += 1
        elif ch in '})]':
            depth -= 1
        elif depth == 0 and body.startswith('...', i):
            j = i + 3
            while j < n and (body[j].isalnum() or body[j] in '_$'):
                j += 1
            name = body[i + 3:j]
            if re.fullmatch(r"[A-Za-z_$][\w$]*", name):
                names.append(name)
            i = j
            continue
        i += 1
    return names


def collect_var_objects(text):
    """收集 `const X = { ... }` 形式的变量声明。

    返回 {变量名: [(声明位置, 对象体文本), ...]}，按位置升序。
    写入语句常常写成 `.insert({ ...base, owner_name: ... })`，字段真实写在
    base 这个变量里。只看 insert 的字面量会漏掉这些字段，所以要跟着
    展开（spread）把变量的字段一并算进来。同名变量可能在不同函数里
    各有一个，因此必须按位置就近取用，不能全局只留一个。
    """
    result = {}
    for match in re.finditer(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{", text):
        name = match.group(1)
        brace = text.find('{', match.end() - 1)
        body, _ = find_object(text, brace)
        if body is not None:
            result.setdefault(name, []).append((match.start(), body))
    for name in result:
        result[name].sort(key=lambda item: item[0])
    return result


def lookup_var(variables, name, position):
    """取用 position 之前最近一次声明的同名变量。"""
    entries = variables.get(name)
    if not entries:
        return None
    chosen = None
    for pos, body in entries:
        if pos < position:
            chosen = body
        else:
            break
    return chosen


def expand_keys(body, variables, position, depth=0):
    """返回对象体顶层的全部 key，含展开进来的变量字段。"""
    if depth > 3:
        return []
    keys = [k for k in top_keys(body) if not k.startswith('...')]
    extra = []
    for target in top_spreads(body):
        sub = lookup_var(variables, target, position)
        if sub is None:
            continue
        extra.extend(expand_keys(sub, variables, position, depth + 1))
    return keys + extra


def check(path):
    text = open(path, encoding='utf-8').read()
    variables = collect_var_objects(text)
    problems = []
    for match in WRITE_CALL.finditer(text):
        table, op = match.group(1), match.group(2)
        if table not in COLS:
            continue
        # 只处理对象字面量实参；.update(变量) 这类由白名单单独保证
        after = text[match.end():match.end() + 200].lstrip()
        if not after.startswith('{'):
            continue
        brace = text.find('{', match.end())
        body, _ = find_object(text, brace)
        if body is None:
            continue
        for key in expand_keys(body, variables, match.start()):
            if key not in COLS[table]:
                line = text[:match.start()].count('\n') + 1
                problems.append((table, op, key, line))
    return problems


def main():
    targets = sys.argv[1:] or [os.path.join(ROOT, 'src', 'services.js'),
                               os.path.join(ROOT, 'src', 'App.jsx')]
    failed = False
    for target in targets:
        path = target if os.path.isabs(target) else os.path.join(ROOT, target)
        problems = check(path)
        rel = os.path.relpath(path, ROOT)
        if problems:
            failed = True
            print('❌ %s 发现 %d 处写入不存在的列：' % (rel, len(problems)))
            for table, op, key, line in problems:
                print('   行 %5d  %s.%s()  字段 "%s"' % (line, table, op, key))
        else:
            print('✅ %s 所有写入字段都存在于数据库表中' % rel)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
