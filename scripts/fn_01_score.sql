-- 计分引擎：问卷客观分确定性计算（服务端唯一真相源）
CREATE OR REPLACE FUNCTION hb_score_survey_answers(p_questions jsonb, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  q jsonb; qid text; qtype text; qweight numeric; raw jsonb; opts jsonb; opt jsonb;
  ratio numeric; got numeric; ceiling numeric; picked jsonb; pick text; label text;
  weighted numeric := 0; weightsum numeric := 0; detail jsonb := '[]'::jsonb; final_score numeric;
BEGIN
  IF p_questions IS NULL OR p_answers IS NULL THEN
    RETURN jsonb_build_object('score', 0, 'detail', '[]'::jsonb, 'weightSum', 0);
  END IF;
  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    qid := q->>'id'; qtype := q->>'type'; qweight := COALESCE((q->>'weight')::numeric, 0);
    raw := p_answers -> qid;
    IF qtype = 'text' THEN
      detail := detail || jsonb_build_object('id', qid, 'title', q->>'title', 'type', 'text',
        'weight', 0, 'got', 0, 'max', 0, 'ratio', NULL::numeric,
        'answer', COALESCE(raw #>> '{}', ''));
      CONTINUE;
    END IF;
    opts := COALESCE(q -> 'options', '[]'::jsonb);
    ratio := 0; got := 0; label := '';
    IF qtype = 'multi' THEN
      ceiling := 0;
      FOR opt IN SELECT * FROM jsonb_array_elements(opts) LOOP
        ceiling := ceiling + COALESCE((opt->>'score')::numeric, 0);
      END LOOP;
      picked := COALESCE(raw, '[]'::jsonb);
      got := 0;
      FOR pick IN SELECT DISTINCT value::text FROM jsonb_array_elements(picked) LOOP
        IF pick IS NOT NULL AND pick <> '' THEN
          got := got + COALESCE(((opts -> (pick::int))->>'score')::numeric, 0);
          IF label = '' THEN label := COALESCE((opts -> (pick::int))->>'label', '');
          ELSE label := label || '、' || COALESCE((opts -> (pick::int))->>'label', ''); END IF;
        END IF;
      END LOOP;
      ratio := CASE WHEN ceiling > 0 THEN LEAST(1, got / ceiling) ELSE 0 END;
    ELSE
      IF raw IS NOT NULL AND jsonb_typeof(raw) = 'number' THEN
        IF (raw::text)::int >= 0 AND (raw::text)::int < jsonb_array_length(opts) THEN
          ratio := LEAST(1, GREATEST(0, COALESCE(((opts -> (raw::text)::int)->>'score')::numeric, 0) / 100));
          label := COALESCE((opts -> (raw::text)::int)->>'label', '');
        END IF;
      END IF;
    END IF;
    got := round((ratio * qweight)::numeric, 2);
    weighted := weighted + got; weightsum := weightsum + qweight;
    detail := detail || jsonb_build_object('id', qid, 'title', q->>'title', 'type', qtype,
      'weight', qweight, 'got', got, 'max', qweight, 'ratio', round((ratio*100)::numeric), 'answer', label);
  END LOOP;
  final_score := CASE WHEN weightsum > 0 THEN round((weighted / weightsum * 100)::numeric, 1) ELSE 0 END;
  RETURN jsonb_build_object('score', final_score, 'detail', detail, 'weightSum', round(weightsum::numeric, 2));
END;
$$;
