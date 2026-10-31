# Release validation — November 1, 2026 (KST)

The public flow was exercised in a real browser: upload the original illustrative video and FAA reference, generate a new Spark draft, edit it, track the parts with SAM, review the source and highlights, render, and download. The recorded example and procedural local fixtures are separately labeled.

| Check | Observed result |
| --- | --- |
| Automated checks | 9 tests passed; TypeScript and Vite build passed; dependency audit reported 0 vulnerabilities at release |
| Real hosted inference | 2 Spark requests and 4 SAM requests; temporary provider files confirmed deleted for all 6 requests |
| Failure handling | First Spark request reached its output limit and did not replace the draft. Retrying with low reasoning effort and an 8,000-token ceiling returned a valid draft. A concept-only tail-rotor request returned no object. |
| Tracking recovery | A box drawn on source frame 210 recovered 840 tail-rotor observations. The next beat reused that full-video result without another call. |
| Other masks | Main rotor and fuselage each returned 839 observations; frame 0 remained empty. Five sampled frames per track were visually compared with the original illustration. Box-center locations were also checked across every observation; this is not a pixel-accuracy benchmark. |
| Source and edits | Claims were compared with FAA PDF pages 6 and 15. Editing an approved caption removed its source approval; the actual export dialog blocked rendering until it was reviewed again. |
| Persistence | The browser-uploaded project survived backend deployment replacement. Private JSON uses conditional writes; actual large-JSON writes and stale-version rejection were checked. |
| Isolation and delivery | A second browser session could neither list nor load another session's project. A hostile origin returned 403. Full video, 12.6 MB reference PDF, and example film were delivered with matching hashes. |
| Final hosted film | H.264, 1080 × 1920, 30 fps, 28.000 seconds, 840 frames, 2,049,328 bytes. Whole-file decoding passed. The actual browser download matched the server's SHA-256. |
| Product demo | H.264/AAC, 1920 × 1080, 30 fps, 179.904 seconds, 5,397 video frames. Whole-file decoding and sampled scene inspection passed. Synthetic narration and edited product captures are disclosed. |
| Publication hygiene | Source, decompressed example archive, and compiled client scanned against actual local credentials; none found. Private account records and preparation are excluded from Git. |

Final hosted film SHA-256:

```text
cdef3e2ba950fe9fc51101aafde1adacf0d0b6a11da5f7423bfdcf0c3a9406b5
```

Product demo SHA-256:

```text
47fea078dfd90c4284c22b35078a5588ecd2e1258875279fd82fe4c7f91c2afc
```

The hosted example is one simplified illustration, not a real-world segmentation benchmark. A quotation match does not prove that a claim is true. Exports are silent; the product demo narration is separate. Public inference and project capacity are bounded, and free hosting quotas can pause service. The recorded example can still be edited and exported without another model call while hosting capacity is available.
