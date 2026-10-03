# Module UI contract

Each module owns `view-model.ts`: typed screen data, explicit empty/error states with a reason, `source`, `ageMs` and `stale`. Unknown ages and sources are `null`; an empty state never claims a live observation. Unit-test the loader. These initial placeholders contain no business logic; module work orders replace them with their typed contracts.

WO-12 owns pages and visual components. It consumes the view model without changing it and requests new fields in review. `plain.tsx` is a minimal working renderer using `<ModuleBoundary>`, with no design work.

Use the boundary's `load` callback for server loaders and rendering that can throw. A React client error boundary catches client render errors, but cannot catch evaluation of an arbitrary server component passed as a child. `load` runs only after the server flag and health checks, and its failures render the same degraded card. Client children get a separate React boundary.

Module flags default off. `/dev` and `/dev/foundation` require a non-production server or `TALLY_DEV_PREVIEWS=1`. The dev index links to the previews module agents will add; skeletons do not provide full pages.
