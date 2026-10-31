# Third-party components and inputs

Dependencies retain their upstream licenses; consult their packaged notices before distribution. The lockfile records the versions used. Local Node and ffmpeg installations are prerequisites and are not bundled with this source.

| Component         | Purpose                                                     | Upstream                                      |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------- |
| React / React DOM | Editor interface                                            | https://github.com/facebook/react             |
| Vite              | Development and client build                                | https://github.com/vitejs/vite                |
| Express / Multer  | Local server and upload handling                            | https://github.com/expressjs                  |
| PDF.js            | PDF text extraction                                         | https://github.com/mozilla/pdf.js             |
| Zod               | Input validation and response schema                        | https://github.com/colinhacks/zod             |
| @napi-rs/canvas   | Local sample and film composition                           | https://github.com/Brooooooklyn/canvas        |
| @meta-sam/parser  | Official SAM stream and mask parsing                        | https://dev.meta.ai/docs/sam/client-libraries |
| ffmpeg / ffprobe  | Video normalization, encoding, and full decode verification | https://ffmpeg.org/                           |
| DM Sans / Manrope | Interface fonts via Google Fonts                            | https://fonts.google.com/                     |

The illustrative helicopter animation is original code in `scripts/create-sample.ts`. It is a simplified explanatory image, not actual aircraft footage or a flight simulator. Its procedural fixture regions are explicitly labeled and do not represent SAM results.

The sample reference is FAA-H-8083-21, Helicopter Flying Handbook, Chapter 2, served by the FAA. Claims cite PDF pages 6 and 15 (printed pages 2-6 and 2-15). The local sample command downloads it; the published verified example includes the attributed reference. This does not imply FAA endorsement.

Meta API integration was implemented from these primary references:

- https://dev.meta.ai/docs/video-understanding
- https://dev.meta.ai/docs/structured-output
- https://dev.meta.ai/docs/sam/segmenting
- https://dev.meta.ai/docs/sam/reading-segmentation
- https://dev.meta.ai/docs/sam/client-libraries

The existing Oddly Clear channel inspired the product problem. Its prior episodes, production scripts, private operational records, and published videos were not copied into this application or claimed as new hackathon work.

## Published verified example

`assets/verified-example.zip` contains the original illustrative MP4, the FAA Chapter 2 reference PDF, page text, real Meta-generated storyboard/masks, and the checked example export. The project-level event record identifies this as recorded inference and product QA, not a new API call by the visitor. The FAA source is attributed separately and is not relicensed as application code. The archive contains no API keys, account receipts, cookies, private preparation, or earlier contest materials.

The hosted version additionally uses `@vercel/blob` (private storage and constrained upload capabilities) and `fflate` (project archives). Their upstream licenses are preserved through their packages. The three-minute demo narration uses the locally installed Samantha system voice and does not imitate the creator's voice.
