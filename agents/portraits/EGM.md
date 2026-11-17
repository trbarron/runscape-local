# Character portraits contract

Source behavior and known limits.

## Scope

Offline appearance rendering and scheduled publication of head and full-body character views.

## Interface

sav.ts reads saved appearance; hook.ts applies client rendering; render.ts produces views; manifest.ts tracks output; watch.ts schedules refresh and publication.

## Invariants

Render the saved equipped appearance, not an unrelated live browser frame. Appearance hashes include angle count but do not cover every renderer or camera change. Keep SDK client and game configs compatible.

## Side Effects

Build scratch files, image files and manifests are written locally. Redis publication uses a transaction; S3 asset batches are not an atomic snapshot. Rendering does not change equipment.

## Verification

Review manifest invalidation, all view names, and publication success handling. A rendering change needs an actual image inspection. Default initial delay is 45 seconds and the next poll is five minutes after completion; configured cadence has a one-minute minimum.
