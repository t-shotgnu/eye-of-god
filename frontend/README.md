# UI Component Library

The app uses [shadcn/ui](https://ui.shadcn.com/docs/installation/vite), Radix primitives, Tailwind CSS 4, and Lucide icons. Components are owned by this repository, under `src/components/ui`. `components.json` configures the registry and the `@/` import alias.

## Source structure

```text
src/
  main.tsx                  # Mount the application and load global styles
  app/                      # Providers, layout, and routes
  features/
    pull-requests/          # Dashboard and PR summaries
    reviews/                # PR/sandbox pages, review state, and publishing
      components/           # Controls, findings, and review results
      diff/                 # Diff rendering and navigation
    settings/               # Settings page and typed form state
      components/           # Settings and credential fields
  components/               # Reusable UI compositions
    ui/                     # Shared UI primitives
  hooks/                    # API resource loading and model catalogs
  lib/                      # HTTP client, error/date formatting, class names
  styles/                   # Layout rules and the divine visual theme
  types.ts                  # API response and domain types
```

Keep route pages focused on composition. Place feature state and behavior beside the feature, and promote code to `components`, `hooks`, or `lib` only when it is shared. Use `useConfiguration` for saved configuration; settings edits remain local until saved. `useApiResource` cancels obsolete loads and hides data from previous paths. PR and publish routes remount when their identity changes so draft controls and pending actions stay with their original review.

## Theme

`src/theme.css` is the source of truth for colors, radii and focus colors. Use semantic tokens (`bg-background`, `text-muted-foreground`, `border-border`, `text-destructive`) rather than literal colors. The divine theme pairs deep ink and illuminated gold with self-hosted Cinzel Decorative headings and SVG eye emblems. Buttons, inputs and select triggers use the standard 36px control height; compact buttons use `size="sm"`. Corners use the shared radius. `src/style.css` imports layout/diff rules from `src/styles/layout.css` and visual treatments from `src/styles/divine.css`; both use the components cascade layer, so utility classes can override them deliberately. Decorative imagery stays hidden from assistive technology, and the emblem's light animation respects reduced-motion preferences.

## Components

| Component                          | Usage                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                           | Primary commands use the default variant, secondary commands use `outline`, approvals use `success`, navigation commands use `link`. Use `asChild` for links. |
| `IconButton`                       | Icon commands with a required accessible `label`, fixed dimensions and a tooltip. Supports `asChild` for links.                                               |
| `Input`, `Textarea`, `Label`       | Text fields, associated labels, disabled and invalid states.                                                                                                  |
| `OptionSelect` / `SelectItem`      | Shared select composition with keyboard navigation, a portal, consistent sizing and viewport bounds.                                                          |
| `Slider`                           | Numeric controls; always supply a label and explicit min/max. `aria-label` and `aria-labelledby` are forwarded to each thumb.                                 |
| `CheckedField`                     | Boolean fields with an associated label. Use `toggle` for a setting and `compact` for credential-clearing checkboxes.                                         |
| `Tabs`                             | Related views and segmented modes with keyboard navigation.                                                                                                   |
| `Collapsible`                      | File diffs, evidence and disclosure sections. Use `defaultOpen` for initial state, or `open` with `onOpenChange` for controlled state.                        |
| `Badge`, `SeverityBadge`           | Status labels. Domain severities map to shared semantic variants.                                                                                             |
| `Alert`, `Notice`                  | Inline feedback. Errors use `role="alert"`; informational notices use `role="status"`.                                                                        |
| `Table`                            | Table structure, scrolling and consistent cells. Diff rows retain their domain coloring and compact spacing.                                                  |
| `Tooltip`, `Separator`, `Skeleton` | Shared overlays, dividers and loading placeholders. The app provides one `TooltipProvider`.                                                                   |

## Extend

Run the official generator from `frontend`:

```sh
npx shadcn@latest add dialog
```

Use `@/lib/utils` for `cn`, and import components from `@/components/ui/...`. Keep reusable compositions in `src/components`; pages should select component variants instead of restyling primitives. Add a semantic variant in the primitive when a new state is shared across the app. Keep business behavior outside the primitives.

```tsx
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/icon-button';
import { RefreshCw } from 'lucide-react';

<Button variant="outline">Save draft</Button>
<IconButton label="Refresh pull requests" onClick={refresh}>
  <RefreshCw />
</IconButton>
```

Radix uses inline styles for slider geometry and overlay placement. The serving backend must permit inline styles in its content security policy. Portaled controls inherit the shared theme from the document root.

## Verify

`npm run build` checks types (including unused code) and builds the production assets. `npm run format` applies Prettier; `npm run format:check` verifies formatting.

`npm test` builds the frontend and runs the integrated demo workflow and component checks against Vite's production preview on port 4173, proxying to an isolated demo API on port 8001. This tests the current assets independently of the backend's root-page handler. Restore .NET packages first with the root `npm run setup` command. To test an already-running frontend, set `PRICK_BROWSER_URL` to its URL; this skips starting both test servers. The two tests named `shared` verify keyboard interaction and responsive layout without saving settings or generating reviews.
