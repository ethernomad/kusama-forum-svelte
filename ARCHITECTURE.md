# Architecture

This document explains how the Kusama Forum Svelte dapp works end to end: runtime model, data flow, publishing flow, indexing, IPFS integration, and how the UI is composed.

## High-level summary

This app is a **client-only SvelteKit dapp** that lets users:

- connect either a Polkadot extension account or an optional Virto passkey-backed account
- create and edit an on-chain profile
- create forums
- create categories inside forums
- create posts linked to categories
- create nested comments
- publish revisions for revisionable content
- react to comments with emoji reactions
- inspect item/revision internals in a debug view

The dapp depends on **three external systems** running alongside the browser app:

1. **Substrate chain node** at `ws://127.0.0.1:9944`
2. **Indexer websocket service** at `ws://127.0.0.1:8172`
3. **Local IPFS/Kubo daemon API** at `http://127.0.0.1:5001`

The browser connects to the local IPFS daemon directly over the Kubo HTTP API for both reads and writes.

In short:

- **Chain** stores canonical item ownership/state and accepts publish/revision/reaction extrinsics.
- **IPFS** stores the actual protobuf-encoded content payloads and image data.
- **Indexer** provides query and subscription APIs so the app can discover published items, revisions, comments, and reactions efficiently.
- **Svelte UI** orchestrates signing, publishing, loading, and live updates.

---

## Runtime and deployment model

### SvelteKit mode

The app is intentionally browser-only:

- `src/routes/+layout.ts` sets `ssr = false`
- `src/routes/+layout.ts` sets `prerender = true`
- `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: 'index.html'`

That means:

- the app is built as a static SPA
- route handling happens in the browser
- chain access, wallet/passkey session access, signing, and IPFS API access all run client-side
- there is no app server storing forum content or mediating transactions
- an optional Virto passkey flow can talk to an external Virto federation/signing backend for WebAuthn auth and extrinsic signing

### Why this matters

This architecture keeps the dapp close to the underlying protocol:

- wallet access stays in the browser
- optional passkey auth can also stay browser-initiated while delegating WebAuthn/session handling to Virto services
- content goes straight to IPFS
- extrinsics go straight to the chain node
- indexed reads come straight from the indexer

---

## Main architectural layers

The codebase is organized around a few clear layers.

### 1. Routes and components

The route layer is in `src/routes/**` and renders the app UI.

Important routes:

- `src/routes/+layout.svelte` — bootstraps global connections/watchers and renders the sidebar
- `src/routes/+page.svelte` — home page, currently the profile page
- `src/routes/my-profile/+page.svelte` — profile entry route; it redirects accounts with an existing profile to `/item_id/[item_id]` and otherwise shows the profile creation form
- `src/routes/trusted-accounts/+page.svelte` — trusted-account manager backed by trusted-accounts chain storage and trust/untrust extrinsics
- `src/routes/forum-admin/+page.svelte` — list forums from `pallet-account-content` and link to forum creation
- `src/routes/create-forum/+page.svelte` — create a top-level forum item
- `src/routes/item_id/+page.svelte` — item lookup form
- `src/routes/item_id/[item_id]/+page.svelte` — generic content viewer for any item; the loaded item title is used as the page heading
- `src/routes/item_id/[item_id]/edit/+page.svelte` — revision editor for editable items; the loaded item title is used as the page heading
- `src/routes/item_id/[item_id]/debug/+page.svelte` — low-level inspection of chain/indexed/IPFS state; the loaded item title is used as the page heading and the item ID is shown under the tabs rather than in the header
- `src/routes/status/ipfs/+page.svelte` — IPFS daemon status page

### 2. Stateful client services

Most application logic lives in `src/lib/services/**`.

Key services:

- `accounts.svelte.ts` — extension account discovery plus optional Virto passkey session account selection
- `balances.svelte.ts` — balance watching for injected accounts
- `connections.svelte.ts` — chain, indexer, and IPFS daemon startup/status
- `indexer.svelte.ts` — websocket client for indexed queries and subscriptions
- `content.ts` — content encoding/decoding, loading, and publishing
- `profile.ts` — profile-specific encoding/loading/publishing
- `trusted-accounts.ts` — trusted-account chain reads, one-hop trust-graph evaluation, and trust/untrust submission helpers
- `content-images.ts` — shared image mixin encoding/decoding, JPEG conversion, mipmap generation, and IPFS preview loading used by both profile and forum content flows
- `ipfs.ts` — direct Kubo HTTP API helpers for `/api/v0/id`, `/api/v0/add`, and `/api/v0/cat`
- `reactions.ts` — fetch and submit reactions
- `chain-signing.ts` — provider-aware signing helper for both extension and Virto passkey accounts

These services use Svelte 5 runes-style `$state` objects as shared client-side stores.

### 3. External protocols

The UI talks to protocol services:

- **Polkadot extension** via `@polkadot/extension-dapp`
- **Virto passkey SDK** via a browser-loaded ESM module for WebAuthn auth and hex extrinsic signing
- **Substrate node** via `@polkadot/api`
- **Indexer** via raw websocket JSON-RPC-like messages
- **IPFS** via the local Kubo HTTP API

---

## Startup lifecycle

App startup is centralized in `src/routes/+layout.svelte`.

On mount it does three things:

1. `loadInjectedAccounts()`
2. `startAppConnections()`
3. `startAccountBalanceWatcher()`

On unmount it stops:

- balance watching
- chain/indexer/IPFS connection maintenance
- indexer subscriptions

### Account loading

`src/lib/services/accounts.svelte.ts`:

- calls `web3Enable('Kusama Forum')`
- fetches injected accounts with `web3Accounts()`
- filters to compatible 32-byte Substrate accounts
- restores any persisted Virto passkey session from local storage
- merges extension accounts with the optional Virto session account into one picker
- restores the last selected account from local storage (`kusama-forum.active-account`)

The account picker in `src/lib/components/AccountSelector.svelte` also exposes a Virto passkey panel where the user can configure the Virto server/provider URLs, register with WebAuthn, sign in with a passkey, and disconnect that session.

### Connection bootstrap

`src/lib/services/connections.svelte.ts` starts three subsystems in parallel:

#### Chain connection

- connects to `ws://127.0.0.1:9944` with `WsProvider`
- creates `ApiPromise`
- reads chain metadata like chain name/node name/version
- subscribes to new headers to keep `latestBlockNumber` updated

#### Indexer connection

- configures a shared connection-state callback
- starts the indexer client from `indexer.svelte.ts`
- subscribes to index status spans
- fetches a current snapshot of indexed spans

#### Local IPFS daemon connection

- polls `POST /api/v0/id` on the configured local Kubo API URL
- records daemon identity details such as peer ID, addresses, agent version, and protocol version
- treats daemon availability as the publishing/readiness gate for IPFS-backed content

There is no in-browser Helia or libp2p node anymore. All IPFS reads and writes go through the local daemon.

---

## Connection/state model

`connections.svelte.ts` exposes a single shared `connections` state object. It contains:

- chain endpoint and status
- connected `ApiPromise`
- latest chain block number
- indexer status and indexed spans
- IPFS daemon API URL and status
- daemon peer ID, addresses, and protocols
- daemon agent/protocol version
- last daemon error

The sidebar component, `src/lib/components/StatusSidebar.svelte`, reads this state and shows:

- a browser-style navigation pane with Back and Forward buttons above the account picker
- a styled sidebar menu with permanent navigation links like My profile, Trusted Accounts, Item ID, and Forum admin
- a separate status pane with chain health, indexer health, and IPFS health
- a link to the dedicated IPFS status page
- Skeleton-styled form controls across the main publishing and editing flows (`input`, `textarea`, `select`, and `btn` classes) for consistent dapp theming

The dedicated status page, `src/routes/status/ipfs/+page.svelte`, is specifically for IPFS and shows:

- local Kubo API status
- daemon peer ID and public key
- advertised addresses
- supported protocols
- last daemon error

So the sidebar is effectively the operator dashboard for the dapp.

---

## Content model

The app revolves around a protocol-specific content item model implemented in `src/lib/services/content.ts`.

### Core idea

A content item is split across two places:

- **chain state / events** store ownership, flags, and revision references
- **IPFS payload** stores the actual content body, title, language, image, etc.

### Supported content types

`content.ts` recognizes these `contentTypeId` values:

- `4` — Profile
- `5` — Forum
- `6` — Category
- `7` — Forum post
- `8` — Comment

These map to the UI types:

- `profile`
- `forum`
- `category`
- `forumPost`
- `comment`

### Content graph semantics

The app models structure with a combination of **parents** and **links**:

- **Forum**: top-level item, no parent, no links
- **Category**: parent is the forum item
- **Forum post**: no parent, but links to a category item
- **Comment**: parent is the commented item, enabling nested replies
- **Profile**: separate special flow, tied to an account via `accountProfile.setProfile`

This means the forum hierarchy is not one single tree:

- forum → category uses **parent relation**
- category → forum post uses **link relation**
- post/comment → replies uses **parent relation**

### Flags

Important flags used by the UI:

- `0x01` — revisionable
- `0x02` — category flag
- `0x04` — retracted

`canEditContent()` requires:

- active account exists
- chain owner matches the active account
- content is revisionable

That is why not every content type can be edited through `/item_id/[item_id]/edit`.

---

## Protobuf payload format

The actual IPFS payloads are protobuf-encoded in the browser.

### Item payload

The app encodes an `ItemMessage` containing:

- `contentTypeId`
- repeated `mixinPayload[]`

Each mixin payload contains:

- `mixinId`
- raw mixin bytes

### Mixins

The dapp currently uses these mixins:

- `LANGUAGE_MIXIN_ID = 0x9bc7a0e6`
- `TITLE_MIXIN_ID = 0x344f4812`
- `BODY_TEXT_MIXIN_ID = 0x2d382044`
- `IMAGE_MIXIN_ID = 0x045eee8c`
- `PROFILE_MIXIN_ID = 0xbeef2144`

This is the key compatibility mechanism: the app encodes content the same way the existing Acuity/Dioxus flow expects.

### Why protobuf is in the frontend

Encoding and decoding happen directly in the browser so the app can:

- create deterministic payloads before signing
- decode IPFS content without a backend
- show debug views for raw mixins and revision contents
- reuse the same schema logic for creation, editing, viewing, and debugging

---

## Item IDs and revisions

### Item ID derivation

For newly created items, the app derives the item ID locally before submission.

`deriveItemId()` computes:

- decode account address to raw 32-byte account id
- concatenate account id + random 32-byte nonce + namespace `1000` encoded as little-endian u32
- hash with `blake2_256`

So item IDs are deterministic from:

- creator account
- random nonce
- fixed namespace

This lets the app know the future item ID immediately after choosing the nonce.

### Revisions

Revision content is stored on IPFS and referenced on-chain by IPFS digest bytes.

To load revisions, the app primarily asks the **indexer** for `Content::PublishRevision` events and sorts by `revision_id`.

That is an important architectural choice:

- the chain is canonical for ownership/state
- the indexer is canonical for discoverability and revision history
- IPFS is canonical for the actual revision payload

---

## Reading data: how the viewer works

The generic viewer route is `src/routes/item_id/[item_id]/+page.svelte`.

In addition to loading content, the viewer also resolves author profile metadata, computes direct + one-hop trust in the frontend from `TrustedAccounts` storage, renders a clickable shield for trust/untrust, and hides only the body/image when the author falls outside the active account's extended trust graph. Profile pages are the exception: they are always viewable, and they also show `Trusted That Trusts` plus `Trusts` account lists.

### Load sequence

When the route loads and the local IPFS daemon is reachable:

1. normalize the item ID
2. call `loadContentByItemId(itemId, api, revisionId?)`
3. fetch latest or selected revision metadata from the indexer
4. fetch chain item state when available
5. fetch revision bytes from IPFS via `POST /api/v0/cat`
6. decode protobuf item payload and mixins
7. derive `created` from the first indexed `PublishRevision` timestamp and `modified` from the latest indexed `PublishRevision` timestamp
8. render content-specific UI

### `loadContentByItemId()` combines three sources

#### 1. Chain state

`fetchItemState()` reads `content.itemState(itemId)` when the runtime API is available.

It extracts:

- owner
- flags
- latest revision id

If owner/flags are unavailable, it falls back to indexed `PublishItem` events.

#### 2. Indexer events

`fetchContentRevisions()` queries `acuity_getEvents` by item key and filters for `Content::PublishRevision`.

From events it extracts:

- `revisionId`
- IPFS hash
- links
- mentions
- top-level hydrated event timestamp from the indexer (`timestamp`)

#### 3. IPFS payload

Using the selected revision's IPFS digest, the app:

- reconstructs a CIDv0
- reads bytes from the local daemon with `POST /api/v0/cat`
- decodes the item protobuf
- extracts title/body/language/profile/image mixins

### Live updates in the viewer

The route subscribes to indexer events for the item key.

On:

- `PublishRevision` → refresh main item content/revision list
- `PublishItem` → refresh comments

That keeps the page live without manual reload.

---

## Writing data: publish flow

Publishing always follows the same broad pattern:

1. validate chain/IPFS/account readiness
2. build protobuf payload in-browser
3. add bytes to IPFS through the local Kubo API
4. sign and submit the chain extrinsic via extension
5. wait for block inclusion
6. rely on the indexer to make the new state discoverable

### Why publishing requires a reachable local daemon

Publishing now depends on the browser being able to reach the local Kubo API. The dapp uploads bytes with `POST /api/v0/add?pin=true&quieter=true`, receives a CIDv0 from the daemon, converts it to the digest bytes expected by the chain, and then submits the extrinsic.

There is no separate ACK queue or custom local pinner protocol anymore.

---

## Specific write flows

### 1. Create profile

Implemented mainly in `src/lib/services/profile.ts` and `MyProfilePage.svelte`.

The `/my-profile` route behaves like a profile entrypoint rather than a permanent editor page:

- if the active account already has an `accountProfile` mapping, the route redirects to `/item_id/[item_id]` for that profile item
- if no profile exists yet, the route shows the profile creation form

Flow:

1. user edits profile fields and optional avatar
2. optional avatar is re-encoded to JPEG in the browser
3. multiple mipmap levels are generated and stored on IPFS
4. profile item payload is built with profile/language/title/body/image mixins
5. payload is uploaded to IPFS
6. if profile already exists:
   - submit `content.publishRevision(itemId, [], [], revisionHash)`
7. if profile does not exist:
   - derive new item ID from nonce
   - batch `content.publishItem(...)` with `accountProfile.setProfile(itemId)` using `utility.batchAll`
   - redirect the user to `/item_id/[item_id]` for the newly created profile after the first successful save

The profile flow is special because the account profile pallet maps an account to a profile item ID.

The forum flow now uses a similar batched-create pattern, except its follow-up call targets `pallet-account-content` so the owner's account content list stays in sync with newly created forums. Forum creation also supports an optional image using the same JPEG+mipmap IPFS image mixin approach as profiles.

### 2. Create forum

`saveForum()`:

- creates a top-level content item
- flags: `FORUM_ITEM_FLAGS = 0x03` (revisionable + retractable)
- no parents
- no links
- optionally re-encodes a selected forum image to JPEG, uploads mipmap levels to IPFS, and appends the image mixin to the forum payload
- derives the future `item_id` locally from account + nonce before submission
- batches `content.publishItem(...)` with `accountContent.addItem(itemId)` using `utility.batchAll(...)`
- atomically records the newly created forum in the owner's `pallet-account-content` list

### 3. Create category

`saveCategory()`:

- content type is category
- parent is the forum item
- no links
- flags include category and revisionable bits
- optionally re-encodes a selected category image to JPEG, uploads mipmap levels to IPFS, and appends the image mixin to the category payload
- submits `content.publishItem(...)`

### 4. Create forum post

`saveForumPost()`:

- content type is forum post
- no parents
- links contain the category item ID
- flags mark item revisionable and retractable
- submits `content.publishItem(...)`
- later retraction is available from the edit route for any retractable item, which submits `content.retractItem(itemId)`; forum posts redirect back to the category page after success while other items fall back to their item page

### 5. Create comment or reply

`saveComment()`:

- content type is comment
- parent is the commented item
- no links
- revisionable and retractable
- submits `content.publishItem(...)`

Replies are simply comments whose parent is another comment item.

### 6. Publish content revision

`publishContentRevision()` handles editing of revisionable content, including inline edits to comments from `CommentItem.svelte`.

It verifies:

- active account owns the item
- item is revisionable

Before submission it rebuilds the revision payload, preserving the current image mixin by default, allowing a newly selected image to replace it, or omitting the image mixin entirely when the user removes the image.

Then it submits:

- `content.publishRevision(itemId, latestLinks, [], revisionHash)`

For forum posts, preserving `latestLinks` is crucial because category membership is encoded there.

### 7. Retract item

`retractItem()` submits `content.retractItem(itemId)`.

The UI filters out retracted categories/posts/comments when rendering lists.

---

## Prepared publish pattern

Both content and profile publishing use a small optimization helper in `prepared-publish.ts`.

The idea is:

- expensive work like image processing or IPFS upload can be done before signature prompt timing matters
- if the inputs have not changed, the app can reuse a precomputed payload/CID

This is exposed through functions like:

- `prepareForumSave()` — including optional forum image processing and upload
- `prepareCategorySave()` — including optional category image processing and upload
- `prepareContentRevision()`
- `prepareProfileSave()`

and resolved through `resolvePreparedValue()`.

Architecturally, that separates:

- **payload preparation**
- **signed chain submission**

which keeps the UX more predictable.

---

## How forum/category/post discovery works

The app does not read a materialized forum tree from the chain. It reconstructs the graph from indexed events.

### Forum → categories

`loadPublishedChildren(parentItemIdHex)` searches indexed `PublishItem` events whose `parents` include the forum item.

`loadForumCategories*()` then loads each child item from IPFS and filters to valid, non-retracted categories owned by the forum owner.

### Category → posts

`loadCategoryPostIds()` queries indexed events keyed by the category item and looks for `PublishRevision` events from other items appearing under that key.

Then `loadCategoryForumPostsIncremental()` loads those items and keeps only forum posts whose `latestLinks` include the category item.

So category membership is inferred through indexed link relationships, not direct chain storage queried from the item itself.

### Comments

`loadCommentTree()` recursively traverses `PublishItem` parent relationships:

- find direct child items of the parent
- load them
- keep only valid comments
- recurse for each comment to build nested replies

Comment cards render the comment timestamp in the browser's local timezone instead of showing chain/block metadata in the header. When multiple comment revisions exist, the card shows a revision dropdown and loads the selected revision body while also pointing reactions at that selected revision. Comments are published with both revisionable and retractable flags. If the active account owns a revisionable comment, the card also shows an inline edit form that republishes the comment body via `publishContentRevision()` while preserving its parent relationship. If the active account owns a retractable comment, the inline action row also exposes a retract button next to Edit.

This makes the comment system a true item tree reconstructed from indexed publish events.

---

## Indexer architecture and why it matters

`src/lib/services/indexer.svelte.ts` is a custom websocket client.

### Supported operations used by the app

- `acuity_indexStatus` — fetch indexed block spans
- `acuity_subscribeStatus` — live indexer status updates
- `acuity_getEvents` — query historical events by key
- `acuity_subscribeEvents` — subscribe to live events by key

### Subscription model

The service keeps:

- a single websocket connection
- a map of pending JSON-RPC requests
- a set of status listeners
- a set of event listeners keyed by custom bytes32/composite keys
- automatic reconnect and resubscription

### Why the indexer is central

Without the indexer, the chain alone would not be enough for this UX. The app relies on the indexer for:

- revision history
- child item discovery
- comment tree discovery
- category/post discovery
- reaction aggregation inputs
- live updates after publish

In practice, the app is architected as **chain + indexer + IPFS**, not just chain + IPFS.

---

## Reactions architecture

Reactions are implemented separately from main content in `src/lib/services/reactions.ts`.

### Read path

`fetchReactions()`:

- queries indexer events keyed by `(item_id, revision_id)` composite key
- filters `ContentReactions::SetReactions`
- keeps only the latest reaction set per reactor account
- aggregates counts by emoji codepoint
- marks whether the active user has reacted

### Write path

`setReactions()` submits:

- `contentReactions.setReactions(itemIdBytes, revisionId, reactions[])`

### UI behavior

`Reactions.svelte`:

- loads reaction summaries when item/revision/account changes
- renders only reactions that currently have counts as compact chips
- lets the active user toggle an existing chip to remove/add that emoji
- uses a Skeleton `Menu` behind a small `+` button for adding new emoji reactions
- hides emoji the active user has already selected from the add-reaction picker
- performs optimistic UI updates
- subscribes to the `(item_id, revision_id)` composite key so all viewers of that revision update live when any account changes reactions
- keeps optimistic state in place until the indexer subscription delivers the corresponding `ContentReactions::SetReactions` update
- reverts on error

Right now reactions are shown under comments via `CommentItem.svelte`.

---

## Trusted accounts

Trusted accounts are implemented in the frontend without using pallet RPC helpers.

`trusted-accounts.ts` reads:

- `TrustedAccounts::AccountTrustedAccountListCount`
- `TrustedAccounts::AccountTrustedAccountList`
- `TrustedAccounts::AccountTrustedAccountIndex`

and computes one-hop extended trust in the browser by checking whether any directly trusted account directly trusts the viewed author.

The dedicated page at `src/routes/trusted-accounts/+page.svelte` lists all directly trusted accounts for the active account and allows removals via `TrustedAccounts::untrust_account`.

The item viewer integrates this same trust graph so title and metadata remain visible, while image/body rendering is restricted for authors outside the extended trust graph.

## Account balances

`balances.svelte.ts` watches balances for all injected accounts.

It works by:

- periodically reconciling the set of known accounts
- fetching each watched account's initial balance directly from chain state via `system.account`
- treating chain state as the authoritative source for the current balance, even when the account has no transfer history yet
- subscribing to indexer events keyed by raw `account_id`
- using those events as refresh triggers that refetch `system.account`

This is not central to content publishing, but it improves wallet/account UX in the selector and ensures development accounts with prefunded balances appear correctly before any transfer event occurs.

---

## UI composition by content type

The generic item viewer renders specialized sub-components depending on decoded `contentType`.

### Forum

`ForumCategories.svelte`:

- incrementally loads categories from indexed parent-child relationships
- renders optional square image thumbnails for existing categories
- renders the category list above the add-category form for easier scanning
- lets the forum owner create new categories, including an optional image using the same upload flow as forum creation
- lets the owner retract categories

### Category

`CategoryForumPosts.svelte`:

- incrementally loads posts linked to the category
- lets any connected account create a new post

### Forum post and comment

`Comments.svelte`:

- loads a recursive comment tree
- subscribes to item events for live refresh
- renders `CommentItem.svelte` recursively
- lets logged-in users comment/reply

### Debug view

`/item_id/[item_id]/debug` is especially useful architecturally because it exposes the three-layer data model:

- chain owner/flags/latest revision
- parents from indexed `PublishItem`
- revision metadata from indexed `PublishRevision`
- raw/decoded mixins from IPFS payload bytes

That route effectively documents the protocol state for a single item.

---

## Ownership and authorization model

The UI does not maintain its own auth system.

Authorization is derived from:

- the selected account provider session (extension or Virto)
- the on-chain owner of the content item
- item flags indicating revisionability

Examples:

- forum owner can add/remove categories
- item owner can publish revisions if the item is revisionable
- any connected account can create posts/comments where the UI allows it
- any connected account can set reactions on a specific revision

All real enforcement still happens on-chain when the extrinsic is executed.

---

## Persistence model

### Persisted on chain

- item ownership/state
- revision publication references
- profile account mapping
- reaction sets
- retractions

### Persisted on IPFS

- protobuf item payloads
- profile avatar JPEGs and mipmaps

### Persisted in browser local storage

- active selected account

### Derived from indexer

- revision history
- item discovery by key
- category/post/comment relationships
- reaction event history
- live update subscriptions

---

## Failure modes and resilience

The app is designed around the fact that its external dependencies may come and go.

### Chain unavailable

- publish actions are blocked
- status shows chain connection failure
- read paths that need chain state may degrade or partially fall back to indexed data

### Indexer unavailable

- revision history and discovery break down
- live updates stop
- many reads cannot reconstruct item relationships

### Local IPFS daemon unavailable

- publishing is blocked unless the browser can reach the local Kubo API
- already-published content may fail to load if not retrievable through the daemon
- the status page surfaces the latest daemon error so operators can fix the local IPFS process

---

## Notable design decisions

### 1. No backend application server

Everything happens in the browser against protocol services.

Pros:

- simpler trust model
- direct wallet integration
- no central content database

Tradeoff:

- more dependency on local infrastructure and browser environment

### 2. Indexer-first discovery

The app uses the indexer heavily instead of trying to reconstruct everything from storage queries.

Pros:

- easier graph traversal
- historical revision access
- live subscriptions

Tradeoff:

- indexer availability is essential for a good UX

### 3. IPFS content as canonical payload source

The chain stores references, not the full document.

Pros:

- cheaper on-chain footprint
- larger/flexible content payloads
- image support

Tradeoff:

- content availability depends on IPFS propagation and pinning

### 4. Compatibility with existing Acuity/Dioxus encoding

The protobuf structure and profile/image behavior intentionally mirror the existing implementation.

Pros:

- ecosystem compatibility
- easier migration/interoperability

Tradeoff:

- frontend carries protocol encoding complexity

---

## File guide

A quick map of the most important files:

### App shell

- `src/routes/+layout.svelte` — app bootstrap and layout
- `src/lib/components/StatusSidebar.svelte` — browser navigation pane, account picker, sidebar menu, and status dashboard
- `src/lib/components/AccountSelector.svelte` — wallet/account picker

### Protocol connections

- `src/lib/services/connections.svelte.ts` — chain/indexer/IPFS daemon startup
- `src/lib/services/indexer.svelte.ts` — indexer transport and subscriptions
- `src/lib/services/ipfs.ts` — direct local Kubo HTTP API helpers

### Content logic

- `src/lib/services/content.ts` — generic content encoding/decoding/load/save
- `src/lib/services/profile.ts` — profile-specific content flow
- `src/lib/services/content-images.ts` — shared content/profile image helper logic
- `src/routes/forum-admin/+page.svelte` — forum admin page backed by account-content storage; each forum row links directly to its forum page, keeps item IDs hidden from the list, and starts with a square forum image thumbnail when available
- `src/lib/services/reactions.ts` — reaction load/save logic
- `src/lib/services/chain-signing.ts` — provider-aware signing helper for extension and Virto passkey accounts
- `src/lib/services/virto-connect.svelte.ts` — Virto SDK loading, passkey registration/login, session persistence, and hex-extrinsic signing

### Main UI features

- `src/lib/components/MyProfilePage.svelte`
- `src/routes/trusted-accounts/+page.svelte`
- `src/lib/components/ForumCategories.svelte`},{
- `src/lib/components/CategoryForumPosts.svelte`
- `src/lib/components/Comments.svelte`
- `src/lib/components/CommentItem.svelte`
- `src/lib/components/Reactions.svelte`

### Routes

- `src/routes/create-forum/+page.svelte`
- `src/routes/item_id/[item_id]/+page.svelte`
- `src/routes/item_id/[item_id]/edit/+page.svelte`
- `src/routes/item_id/[item_id]/debug/+page.svelte`
- `src/routes/status/ipfs/+page.svelte`

---

## End-to-end example

Here is the full path for creating a forum post:

1. User selects an extension account.
2. App has already connected to chain, indexer, and the local IPFS daemon.
3. User opens a category page.
4. `CategoryForumPosts.svelte` submits `saveForumPost()`.
5. `content.ts` encodes the post into protobuf item bytes.
6. `uploadIpfsDigest()` uploads the bytes to the local Kubo API.
7. The daemon returns a CID whose digest is passed into the extrinsic.
8. `saveForumPost()` derives an item ID from account + nonce + namespace.
9. It submits `content.publishItem(nonce, [], flags, [categoryId], [], revisionHash)`.
10. The extension signs the extrinsic.
11. The app waits for block inclusion.
12. The user is redirected to `/{itemId}`.
13. The viewer route queries the indexer for revision events.
14. The viewer fetches the IPFS payload via the local Kubo API.
15. The post is decoded and rendered.
16. Future revisions or comments appear live through indexer subscriptions.

That sequence is representative of almost every feature in the app.

---

## In one sentence

This dapp is a **static, browser-only Svelte client** that uses either a **Polkadot extension or optional Virto passkey flow for signing**, a **Substrate node for canonical state**, an **indexer for history/discovery/live updates**, and a **local Kubo IPFS daemon over its HTTP API for content storage and retrieval**.
