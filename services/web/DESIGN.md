# Web Design System

This document is the source of truth for the web service's visual language. It defines tokens and the rules for using them. The values are implemented in `app/globals.css`; fonts are loaded in `lib/fonts.ts`. Components in `components/ui` are consumers of these foundations.

## Principles

- **Dark-first.** Dark is the default theme. Light is supported through the same semantic tokens, never a separate palette.
- **Semantic over literal.** Surfaces and text use semantic color tokens. Raw palette classes are reserved for the brand accents and data visualization listed below.
- **One accent, used sparingly.** A blue-to-purple gradient marks the single highest-intent action on a view. Everything else is neutral.
- **Motion is quiet.** Transitions are short; decorative motion loops slowly and never blocks interaction.

## Theme

Theme is class-based: `.dark` on the root element switches every token. The system preference can override the default. Theme changes do not animate.

## Color tokens

Values are HSL so opacity modifiers (`/50`, `/80`) and dark-mode inversion behave consistently.

### Light

| Token | Value | Role |
| --- | --- | --- |
| `background` | `hsl(0 0% 100%)` | App canvas |
| `foreground` | `hsl(240 10% 3.9%)` | Primary text |
| `card` | `hsl(0 0% 100%)` | Raised surfaces |
| `card-foreground` | `hsl(240 10% 3.9%)` | Text on cards |
| `popover` | `hsl(0 0% 100%)` | Floating surfaces |
| `popover-foreground` | `hsl(240 10% 3.9%)` | Text in popovers |
| `primary` | `hsl(240 5.9% 10%)` | Structural primary controls |
| `primary-foreground` | `hsl(0 0% 98%)` | Text on primary |
| `secondary` | `hsl(240 4.8% 95.9%)` | Secondary controls |
| `secondary-foreground` | `hsl(240 5.9% 10%)` | Text on secondary |
| `muted` | `hsl(240 4.8% 95.9%)` | Muted surfaces, tracks |
| `muted-foreground` | `hsl(240 3.8% 46.1%)` | Supporting text |
| `accent` | `hsl(240 4.8% 95.9%)` | Hover/focus surface |
| `accent-foreground` | `hsl(240 5.9% 10%)` | Text on accent |
| `destructive` | `hsl(0 84.2% 60.2%)` | Errors, destructive actions |
| `destructive-foreground` | `hsl(0 0% 98%)` | Text on destructive |
| `border` | `hsl(240 5.9% 90%)` | Default borders |
| `input` | `hsl(240 5.9% 90%)` | Field borders |
| `ring` | `hsl(240 10% 3.9%)` | Focus ring |
| `radius` | `0.5rem` | Base corner radius |

### Dark

| Token | Value | Role |
| --- | --- | --- |
| `background` | `hsl(240 10% 3.9%)` | App canvas |
| `foreground` | `hsl(0 0% 98%)` | Primary text |
| `card` | `hsl(240 10% 3.9%)` | Raised surfaces |
| `card-foreground` | `hsl(0 0% 98%)` | Text on cards |
| `popover` | `hsl(240 10% 3.9%)` | Floating surfaces |
| `popover-foreground` | `hsl(0 0% 98%)` | Text in popovers |
| `primary` | `hsl(0 0% 98%)` | Structural primary controls |
| `primary-foreground` | `hsl(240 5.9% 10%)` | Text on primary |
| `secondary` | `hsl(240 3.7% 15.9%)` | Secondary controls |
| `secondary-foreground` | `hsl(0 0% 98%)` | Text on secondary |
| `muted` | `hsl(240 3.7% 15.9%)` | Muted surfaces, tracks |
| `muted-foreground` | `hsl(240 5% 64.9%)` | Supporting text |
| `accent` | `hsl(240 3.7% 15.9%)` | Hover/focus surface |
| `accent-foreground` | `hsl(0 0% 98%)` | Text on accent |
| `destructive` | `hsl(0 62.8% 30.6%)` | Errors, destructive actions |
| `destructive-foreground` | `hsl(0 0% 98%)` | Text on destructive |
| `border` | `hsl(240 3.7% 15.9%)` | Default borders |
| `input` | `hsl(240 3.7% 15.9%)` | Field borders |
| `ring` | `hsl(240 4.9% 83.9%)` | Focus ring |
| `radius` | `0.5rem` | Base corner radius |

### Sidebar tokens

| Token | Light | Dark |
| --- | --- | --- |
| `sidebar` | `hsl(0 0% 100%)` | `hsl(240 10% 3.9%)` |
| `sidebar-foreground` | `hsl(240 5.3% 26.1%)` | `hsl(240 4.8% 95.9%)` |
| `sidebar-primary` | `hsl(240 5.9% 10%)` | `hsl(224.3 76.3% 48%)` |
| `sidebar-primary-foreground` | `hsl(0 0% 98%)` | `hsl(0 0% 100%)` |
| `sidebar-accent` | `hsl(240 4.8% 95.9%)` | `hsl(240 3.7% 15.9%)` |
| `sidebar-accent-foreground` | `hsl(240 5.9% 10%)` | `hsl(240 4.8% 95.9%)` |
| `sidebar-border` | `hsl(220 13% 91%)` | `hsl(240 3.7% 15.9%)` |
| `sidebar-ring` | `hsl(217.2 91.2% 59.8%)` | `hsl(217.2 91.2% 59.8%)` |

### Chart tokens

| Token | Light | Dark |
| --- | --- | --- |
| `chart-1` | `hsl(12 76% 61%)` | `hsl(220 70% 50%)` |
| `chart-2` | `hsl(173 58% 39%)` | `hsl(160 60% 45%)` |
| `chart-3` | `hsl(197 37% 24%)` | `hsl(30 80% 55%)` |
| `chart-4` | `hsl(43 74% 66%)` | `hsl(280 65% 60%)` |
| `chart-5` | `hsl(27 87% 67%)` | `hsl(340 75% 55%)` |

## Brand palette

These are the only raw color values allowed outside charts. They do not change between themes; adjust opacity for dark surfaces.

| Name | Scale | Use |
| --- | --- | --- |
| Brand blue | `blue-500` / `blue-600` / `blue-700` | Gradient start, links, active indicators, glows |
| Brand purple | `purple-500` / `purple-600` / `purple-700` | Gradient end, AI-associated data |
| Ambient cyan | `cyan-300` / `cyan-500` | Background gradient and progress sweeps only |
| Success | `emerald-500` / `emerald-600` | Positive results, human-authored data |
| Danger | `red-400` / `red-600` | Errors and destructive emphasis |

The canonical brand gradient is `from-blue-600 to-purple-600`, with `hover:from-blue-700 hover:to-purple-700` and a `shadow-blue-500/20` glow. The extended ambient form is `from-purple-300/30 via-blue-300/30 to-cyan-300/30`, reduced to `/20` opacity in dark mode.

## Primary and secondary schemes

There are two kinds of "primary" and they must not be confused.

**Structural primary** is the semantic default: `bg-primary text-primary-foreground`. It is neutral in both themes (near-black on light, near-white on dark) and is the default for buttons and badges.

**Brand primary** is the gradient CTA: white text on `bg-gradient-to-r from-blue-600 to-purple-600`, with `border-0`, `shadow-lg`, and the hover states above. Use it for exactly one action per view — sign up, upgrade, subscribe to the featured plan, submit. Hero CTA labels use the display font at `text-2xl`.

Secondary treatments, from heaviest to lightest:

- **Secondary** — `bg-secondary text-secondary-foreground`, hover `bg-secondary/80`. For companion actions.
- **Outline** — `border bg-background`, hover `bg-accent text-accent-foreground`; in dark mode `bg-input/30 border-input`, hover `bg-input/50`. For non-featured choices such as the non-recommended pricing plan.
- **Ghost** — transparent, hover `bg-accent text-accent-foreground` (`/50` in dark). For toolbar and navigation actions.
- **Link** — `text-primary underline-offset-4 hover:underline`. For inline navigation.

Destructive is `bg-destructive text-white`, hover `bg-destructive/90`, with a destructive focus ring; in dark mode use `dark:bg-destructive/60`.

## Typography

| Font | Utility | Role |
| --- | --- | --- |
| Inter | `font-sans` | Default UI font — body copy, labels, forms, tables, data |
| Teko | `font-display` | Display — page and section headings, metric values, CTA labels, uppercase eyebrows |
| Merriweather | `font-editorial` | Editorial body — long-form descriptive paragraphs such as hero copy |

The three families are exposed as CSS variables `--font-inter`, `--font-teko`, and `--font-merriweather`, mapped to the utilities above. Use them explicitly where listed; do not use display or editorial fonts for dense UI text.

### Type scale

| Context | Treatment |
| --- | --- |
| Hero headline | `text-5xl sm:text-6xl lg:text-8xl font-extrabold tracking-tighter` |
| Hero body | `text-sm lg:text-lg leading-relaxed tracking-wide`, `font-editorial`, `max-w-2xl` |
| Section / page heading | `text-2xl sm:text-3xl font-medium`, `font-display` |
| Card title | `text-xl sm:text-2xl font-semibold` |
| Metric / price | `text-3xl sm:text-4xl font-extrabold leading-none tracking-tight`, `font-display` |
| Body | `text-sm sm:text-base leading-relaxed` |
| Eyebrow / status label | `text-[10px] sm:text-[11px] font-bold uppercase tracking-widest`, `font-sans` |
| Field label | `text-sm font-medium` |

## Radius and shape

| Element | Radius |
| --- | --- |
| Controls (buttons, badges, small chips) | `rounded-md` |
| Inputs, cards, panels | `rounded-lg` |
| Large surfaces, pricing cards | `rounded-xl` |
| Analysis panels | `rounded-2xl` |
| Pills, avatars, progress tracks, indicators | `rounded-full` |

The base token is `0.5rem`; derived radii are `0.6`, `0.8`, `1.4`, `1.8`, `2.2`, and `2.6` times that value.

## Layout and spacing

- The app shell is `min-h-screen flex flex-col`; the main column grows to fill it.
- Landing content uses `max-w-5xl mx-auto` with `px-4 sm:px-6` gutters.
- Card padding is `p-6`; section rhythm is `space-y-8`, with `mt-8` between blocks inside cards.
- Lists use `space-y-4`; icon/text pairs use `gap-2` or `gap-3`.
- Dividers are `h-px w-full bg-black/10 dark:bg-white/10`.
- Standard icon size is `size-4`; larger affordances use `size-5`.

## Surfaces and elevation

Base surfaces are flat: `bg-background`/`bg-card` with `border-border`.

Floating and featured surfaces use a glass treatment:

- Light: `bg-white/70 backdrop-blur-sm border-black/10`
- Dark: `bg-black/40 backdrop-blur-sm border-white/10`, elevated to `bg-black/60` for analysis panels

Shadows are subtle and tinted: `shadow-sm` for small cards, `shadow-lg shadow-blue-500/20` for featured cards and CTAs, and a wide `0 20px 40px -15px` blue-tinted shadow for pricing cards on hover.

## Motion

| Duration | Use |
| --- | --- |
| `200ms` | Tabs, small hover states |
| `300ms` | Standard transitions, badge and chevron movement |
| `500ms` | Hero reveal, larger hover states |
| `600ms` | Entrance animations |

Entry motion fades in and lifts content (`opacity 0 → 1`, `y 30 → 0`) with staggered delays. Interactive elements use `hover:scale-105` / `active:scale-95` for the hero CTA and `hover:-translate-y-1` for cards.

Decorative loops: the slow gradient runs `15s ease infinite`, the moving gradient `3s linear infinite`, and marquees use a `var(--duration)` linear loop. `animate-pulse` marks active status dots only.

Enable `scroll-behavior: smooth` only inside `prefers-reduced-motion: no-preference`; never animate theme changes.

## States and accessibility

- Every interactive element gets a `focus-visible` ring: `ring-ring/50`, `3px`, plus `border-ring`.
- Invalid fields use `aria-invalid:border-destructive` and `aria-invalid:ring-destructive/20` (`/40` in dark).
- Disabled controls are `pointer-events-none opacity-50`.
- Control heights are `h-8` (sm), `h-9` (default), `h-10` (lg), with `size-8/9/10` icon variants.
- Text must keep contrast against both themes; never rely on a gradient for small body text.
- Icons are `pointer-events-none` and inherit `shrink-0`; un-sized icons default to `size-4`.

## Data visualization

Use `chart-1` through `chart-5` for generic series. Analysis results have fixed meaning: emerald is human-authored, purple is AI-generated. The comparison meter uses emerald for the human segment and purple for the AI segment with soft color-matched glows; an in-progress sweep uses `from-blue-500 via-cyan-500 to-blue-600`.

## Usage rules

1. Use semantic tokens for all surfaces, borders, and text.
2. Use the brand gradient only for the single primary CTA and deliberate highlights (active nav indicator, featured plan edge).
3. Keep class names static so they can be statically analyzed; compose conditional classes through `cn()`.
4. Every screen must be reviewed in both themes before it is considered done.
5. Raw palette classes and arbitrary values outside the brand and chart exceptions above are lint errors, not style preferences.
