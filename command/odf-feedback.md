---
description: "Preview and optionally submit private ODF quality/cost feedback. Usage: /odf-feedback <change>"
---

# ODF: Optional Feedback

Use this command only when the user explicitly starts `/odf-feedback`.

1. Resolve one exact change name from the command argument or ask the user. Ask for an integer quality rating from 1 to 5 if they did not provide one. Do not request free-text feedback.
2. Call `odf_feedback_submit` with `action: "preview"`, the change name, and rating. This reads only recent local metrics for the current session and change; preview writes nothing to disk and creates a five-minute, one-time in-memory token bound to the exact payload.
3. Show the returned preview, including the destination host, aggregate values, and receiver-retention notice. Explain that prompts, responses, free text, session/change IDs, paths, and estimated usage are excluded. The receiver must enforce the configured retention of at most 30 days; ODF cannot verify that.
4. Ask whether the user explicitly confirms this one-time remote submission. If they decline, stop without sending.
5. Only after a clear affirmative answer, call `odf_feedback_submit` with the same change/rating, `action: "submit"`, `confirm_remote_submission: true`, and the exact `confirmation_token` from the preview. The tool rejects expired, reused, mismatched, or stale previews.

Never submit automatically after a workflow, retry a failed request, add free-text data, or claim that feedback proves efficacy improvements. If the endpoint or safe local aggregate is unavailable, report that nothing was sent.
