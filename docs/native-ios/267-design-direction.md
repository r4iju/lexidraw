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

## Dedicated title Search, #270

Search now owns its query, response state and explicit navigation routes. The
system Search tab and searchable field provide native keyboard behavior;
iPad exposes the same destination in its sidebar without changing the existing
folder tree. Idle invites finding a file and explains global accessible titles,
with document contents excluded. Loading, failed/retry and no matching titles
have distinct native presentations. Clear query stays in the content while
native search hides the normal toolbar. Results reuse Library's file identity,
then separate the location and a visible, full-height reveal action.

A query change, clear, retry or shared mutation/foreground revision cancels the
previous request and assigns a new generation. Success and failure both verify
that generation and cancellation before publishing. Navigation routes also
reject writes from departed stacks: NavigationSplitView can otherwise clear a
retained route while replacing its detail. Folder destinations use folder IDs
so revealing a different folder at the same depth cannot reuse its old contents.

Opening a file or folder and switching destinations retains Search's query and
results. Revealing an accessible folder selects Library, resets its root to
Library/Home, clears tags and opens that folder with a route back to the root.
The API conceals inaccessible parents and uses the same null location for root
files. Those results honestly say “Library or Shared”; reveal resolves the
accessible listing, using Shared when the containing folder is private, and
shows recovery feedback if the location is unavailable. No private folder
names or new service contract are assumed.

Folder-local duplicate search has been removed. The stable Search tab or
sidebar destination replaces it, retaining the browsing folder and filters
while offering global titles. Folders opened inside Search return to their
query through Back or the Search results breadcrumb. Keeping search in its
own destination leaves Settings, tags and creation visible in folder toolbars.
Listener, file actions, permissions and the shared revision stay at the browser
boundary. Native evidence and red/green commands are in
`/tmp/lexidraw-267/270-notes.md`.

## Document reading and writing, #271

Documents open in a deliberate reading state, including documents the service
permits editing. A calm content header gives the full title, document identity,
reading/editing state and save or access status. Native navigation retains the
file title, Comments and the explicit Edit/Done action. The reading title wraps;
editing removes that duplicate title to leave more room for text and the keyboard.
Authored typography, headings, media, structural previews and the native content
surface retain their existing rendering. Glass stays in the system controls.

Edit changes input policy on the mounted EditorView. Its model, history,
selection and document settings remain intact. The native selection interaction
switches between selectable reading and editable text. Done commits marked
composition while writing is still permitted, closes input, returns to reading
and flushes autosave. Hide keyboard remains independent of Done and navigation;
tapping text resumes input while editing. A compact native Format menu groups
character styles and Link, leaving Block, Lists, Insert, Undo/Redo and Hide
keyboard visible in the phone accessory. Formatting also retains native
selection menus, with Comments available in both states. Passive structural previews remain passive; sticky captions retain their
shared editor after it has been mounted for writing.

Back while writing or holding unsaved work ends input and attempts the save
before leaving. Failure or conflict keeps the document and recovery actions on
screen. Retry retains the current content. Conflict offers the existing Reload
Theirs or Keep Mine as a Copy contract, with adaptive native buttons. Read-only
and unsupported-content notices remain explicit, and the latter also names the
unsupported parts and explains that source is preserved. No service permission,
revision precondition, serialization or HTML-block source/runtime contract is
expanded. Evidence and verification limits are in `/tmp/lexidraw-267/271-notes.md`.

## Account entry and settings, #272

Signed-out entry uses a calm, scrollable introduction and a persistent native
Sign In control. The existing shared system authentication session, custom-scheme
callback, PKCE exchange and secure token storage remain the authentication path.
Progress disables repeated submission. Cancellation returns to ready without an
error; failure offers retry and scrolls into view at accessibility text sizes.
Routine entry does not expose tokens, transport errors or an invented profile.

Settings remains the consistent account sheet in the primary destinations and
folders. Its native form groups actual account name/email from the existing
`/me` response, sign-out, listening information and permanent account deletion.
Absent identity stays neutral; failed identity loading retains the actions and
retry. At accessibility sizes, identity text uses the full row width. Sign-out
explains its device scope and preserves local secure-storage failure recovery
and the distinct warning when server revocation cannot be confirmed.

Deletion retains every existing consequence, server-supplied typed confirmation
and server validation. Loading, retry, independent keyboard dismissal, deletion
progress and retained confirmation after refusal keep recovery explicit. During
an account mutation, repeated submission and sheet dismissal are blocked; Back
is unavailable during deletion. No production deletion is used for verification.

Read Aloud information is reachable from Settings without granting permission.
It shares the exact provider/audio-storage/microphone disclosure with the real
consent sheet. The sheet scrolls through the complete disclosure and wraps the
Allow action at large text sizes, preserving Cancel and the existing browsing
session authorization scope. Consent is never replaced with a fake preference.
Native screenshots and test-first evidence are in `/tmp/lexidraw-267/272-notes.md`.

## iPad adaptation and accessible recovery, #273

iPad uses the same retained Library, Shared, and Search contexts in a native
three-column split view: destination/folder sidebar, contextual listing, and
independent file detail. Opening a file leaves its listing available beside it.
Command-1/2/3 select the primary destinations. Trash is secondary sidebar
navigation; returning preserves the originating Library folder. Settings is also a secondary sidebar action with Command-comma; the account
control stays in each listing toolbar. Narrow windows show the listing and file
with the native sidebar toggle; wide windows show all three columns. Closing or replacing an editable detail waits for the existing
document/drawing save boundary; failures and conflicts keep the file open.

At accessibility text sizes, rows give their space to complete titles, type
and metadata. The sidebar widens and omits decorative folder icons at these
sizes, while content continues to scroll. Shared access and Search scope explanations
scroll after their files rather than pinning over metadata. Search and service recovery use
intrinsic, scrolling copy/actions rather than a fixed unavailable-view layout.
Search has a persistent native navigation search field. Keyboard entry yields
the phone destination bar; submission and keyboard dismissal preserve the query.
The field’s native clear action remains reachable even with maximum text. Document
identity/status uses its intrinsic height, capped to a bounded, independently
scrolling portion of the viewport, leaving actual document content reachable
in compact landscape. Editing hides the phone destination bar to prevent its
glass controls from overlapping the native formatting accessory. Done restores
primary navigation. Read-aloud controls retain explicit labels, generous hit
regions, independent sheet dismissal, and reduced-motion transitions. The iPad
player reserves space beneath the split view so drawing tools remain usable
in their system bottom toolbar above it.

System materials remain confined to native navigation, drawing tools, and the read-aloud control
layer. Enabled dark appearance, maximum text, increased contrast, reduced
transparency and reduced motion are inspected on the pooled devices. Native
audit findings and simulator limitations are retained in
`/tmp/lexidraw-267/273-notes.md`; independent whole-app review remains separate.

At accessibility text sizes, small saved images retain their natural geometry while
captions use the document column so words remain readable. Shared uses the same
concise destination title in the sidebar and navigation bar, and its access
explanation scrolls with the files instead of obscuring permission metadata.

Ordinary single-character UIKit input callbacks retain separate input turns even
when UIKit delivers several before the queued turn-end callback. This preserves
the existing model's typing-burst undo grouping without changing history or
composition contracts; prediction, QuickPath and Japanese marked text remain
independently verified against the native input seam and saved web goldens.
