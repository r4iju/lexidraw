# Native iOS design direction

Scope: #267, with the navigation shell delivered by #268. iPhone first; later
library, search, document, account, and iPad tickets own their detailed changes.

## Running audit, 8 October 2026

Inspected BrowserHarness on a leased iPhone (iOS 27) with populated Home,
Projects, and Q3 fixtures, and EditorHarness with the production document
screen in read and edit access modes. Evidence lives in `/tmp/lexidraw-267`.

The browser's grouped content surfaces are calm and the system already gives
its toolbars glass. The collapsed split view makes Home look like a detail
screen with a back button. Shared and Trash require returning to the sidebar.
Settings disappears in folders. Folder tiles and document rows have different
visual density, and the short fixture titles do not establish long-title
usability. Search is embedded in every folder; the scope is global titles,
but neither its location nor its prompt explains that clearly. The shared
fixture is empty, so it establishes reachability and empty presentation only.
The document fixture shows authored bold/italic text, Japanese text and emoji
on a plain surface. Read access has an explicit Read only banner and no
keyboard. Edit access shows Saved, opens the native keyboard on touch, and
provides an independent Hide keyboard action. These are behaviors to retain.

## Concrete native screen proposals

- **Library:** large Library title, standard grouped list, native filter and
  plus menus, account control, and secondary Trash navigation. Three stable
  labeled tabs remain visible. Later #269 should refine recognizable file
  previews, two-line titles, type and update metadata, and loading/empty/retry
  presentation without glass backgrounds on rows.
- **Folder:** inline current-folder title with existing ancestor title menu,
  native back navigation, permission-gated creation, consistent account
  access, and the same calm list treatment as Library. Returning or switching
  tabs retains the folder path and filters. Keep existing permission checks.
- **Search:** a stable magnifying-glass destination. For #268, show an honest
  explanatory empty surface: “Search by title in Library”, global accessible
  title-only scope, and an action returning to the retained Library context.
  Existing folder search stays functional. #270 owns dedicated query state,
  results, location metadata, cancellation, error/retry, and reveal-in-folder.
- **Shared:** a large title, familiar person symbols, consistent account
  control, independent navigation stack, and native empty/retry presentation.
  Do not offer creation in a recipient's shared listing. Later rows should
  communicate access without assuming containing-folder permissions.
- **Settings:** a native sheet with inline title and Done, semantic grouped
  account actions, destructive deletion separated from sign-out. Preserve
  server confirmation and failure behavior. Later account polish should make
  consequences clearer without inventing unsupported preferences.
- **Reading:** authored document type and formatting on a plain content
  surface. Retain selection/copying, comments and read-aloud. A later document
  ticket should give opening an explicit keyboard-free reading mode and a
  discoverable Edit action when permitted, with save status in the control
  layer. The existing read-only presentation supplies the permission seam.
- **Editing:** retain the native text engine, composition, selection, undo,
  formatting, independent keyboard dismissal, autosave and conflict recovery.
  Use system contextual controls around the document; do not place glass over
  the text. Later document tickets own the reading/editing interaction and polish.

## Shell implementation boundaries

iPhone uses SwiftUI TabView and one persistent NavigationStack per destination.
iPad keeps its existing NavigationSplitView, tree selection, breadcrumbs and
folder behavior until #273. Choose by device idiom so an iPhone in landscape
never unexpectedly becomes a sidebar app. Browser remains the shared app
navigation/environment boundary; FileActions and Listener remain single
instances, preserving invalidation and read-aloud across tabs. Settings is a
consistent secondary account control. Trash belongs to Library, not a tab.
No web, service, serialization, permission or editor-engine changes are needed.

## Apple guidance checked

Current official guidance was fetched on 8 October 2026:

- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass):
  native bars, sheets and controls adopt system materials; custom backgrounds
  can interfere. Navigation is the functional layer, content remains legible.
- [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars):
  tabs navigate rather than act, stay labeled and available, and preserve
  navigation state within each section.
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
  and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility):
  use semantic styling and verify the system's adaptations for accessibility.

No custom glass effect or fixed navigation background is introduced. Native
labels, SF Symbols, system type and semantic content colors allow the shell to
adapt to dark mode, larger text and reduced transparency/motion. Visual audit
is evidence for this shell, not a claim that all parent-spec journeys are done.

## Library and organization, #269

Library, folders, Shared and Trash now share a readable row hierarchy: a larger
preview (or a centered type symbol on a quiet semantic accent), a medium-weight
title, explicit type, and update/access/tag metadata. Standard titles can occupy
two lines; accessibility sizes expand without a line cap. Folders use the same
rows, including the actual subfolder count when available, instead of compact
single-line tiles. Color supplements the written type, so identification does
not depend on color or a successful image request.

Every listing row has a separate, labeled ellipsis menu alongside its native
opening action. The same permission-gated actions remain available through
swipes and context menus. Link sharing uses the system ShareLink presentation;
read-aloud retains its consent step. Rename uses a native form sheet with the
current file preview and explicit Cancel/Rename controls. Move puts the moving
file in the scrollable content, leaving the native navigation title and toolbar
available for the destination and confirmation even with long names.

An empty permitted location offers creation directly. Read-only folders explain
why they offer no creation. Active tags occupy a persistent content inset, so an
empty result never covers the clear action. Shared explains parent-independent
access and each row shows its own access. Loading is named; list failures retain
retry; Trash offers a visible Restore button, a busy value for accessibility,
and guards duplicate restores. At accessibility sizes, restore controls flow
below the file rather than squeezing its title. Completion announcements remain,
and their custom movement respects Reduce Motion. iPhone root references use
Library; iPad retains Home and its existing sidebar/navigation model.

Verification and native screenshots for this slice are recorded in
`/tmp/lexidraw-267/269-notes.md`. Dedicated Search, document interaction,
sign-in/account redesign and the iPad navigation adaptation remain owned by
subsequent tickets. No service/API/schema expansion accompanies this slice.
