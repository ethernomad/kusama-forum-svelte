# Architecture

This document explains how the Kusama Forum Svelte dapp works end to end: runtime model, data flow, publishing flow, indexing, IPFS integration, and how the UI is composed.

## High-level summary

This app is a **client-only SvelteKit dapp** that lets users:

- connect a Polkadot extension account
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
3. **Local IPFS/Kubo pinner** reachable on the configured local libp2p websocket addresses

It also starts an **in-browser Helia/libp2p node** so the browser can read and publish IPFS content directly.

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
- chain access, extension access, signing, and Helia all run client-side
- there is no app server storing content or mediating transactions

### Why this matters

This architecture keeps the dapp close to the underlying protocol:

- wallet access stays in the browser
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
- `src/routes/my-profile/+page.svelte` — profile editor/view
- `src/routes/create-forum/+page.svelte` — create a top-level forum item
- `src/routes/item_id/+page.svelte` — item lookup form
- `src/routes/item_id/[item_id]/+page.svelte` — generic content viewer for any item
- `src/routes/item_id/[item_id]/edit/+page.svelte` — revision editor for editable items
- `src/routes/item_id/[item_id]/debug/+page.svelte` — low-level inspection of chain/indexed/IPFS state
- `src/routes/status/ipfs/+page.svelte` — IPFS-specific status page with pinner queue details

### 2. Stateful client services

Most application logic lives in `src/lib/services/**`.

Key services:

- `accounts.svelte.ts` — wallet/extension account discovery and selection
- `balances.svelte.ts` — balance watching for injected accounts
- `connections.svelte.ts` — chain, indexer, and Helia startup/status
- `indexer.svelte.ts` — websocket client for indexed queries and subscriptions
- `content.ts` — content encoding/decoding, loading, and publishing
- `profile.ts` — profile-specific encoding/loading/publishing, including image processing
- `ipfs-publish.ts` — publish bytes to IPFS and coordinate local pinner ACKs
- `ipfs-pinning-queue.svelte.ts` — persistent background queue for local pinner acknowledgements
- `reactions.ts` — fetch and submit reactions
- `chain-signing.ts` — generic extension signing/finalization helper

These services use Svelte 5 runes-style `$state` objects as shared client-side stores.

### 3. External protocols

The UI talks to protocol services:

- **Polkadot extension** via `@polkadot/extension-dapp`
- **Substrate node** via `@polkadot/api`
- **Indexer** via raw websocket JSON-RPC-like messages
- **IPFS** via Helia + libp2p + UnixFS

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
- restores the last selected account from local storage (`kusama-forum.active-account`)

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

#### In-browser IPFS node

- creates a singleton `libp2p` instance with websocket, WebRTC, WebTransport, relay, noise, yamux, identify, ping, and DHT client mode
- wraps it in Helia
- bootstraps against a mix of global bootstrap nodes and local IPFS bootstrap addresses
- tries to dial the local IPFS/Kubo pinner
- periodically refreshes IPFS status
- periodically retries local reconnects
- flushes any pending CID ACK queue entries once local connectivity exists

### Why Helia is global

`getOrCreateHeliaNode()` caches the Helia node on `globalThis`.

That prevents accidental creation of multiple browser IPFS nodes during client-side navigation or hot reloads, and keeps the peer identity stable within the session.

---

## Connection/state model

`connections.svelte.ts` exposes a single shared `connections` state object. It contains:

- chain endpoint and status
- connected `ApiPromise`
- latest chain block number
- indexer status and indexed spans
- Helia peer ID and current swarm addresses
- active IPFS connections
- whether the app has the required local IPFS connection
- last local dial error

The sidebar component, `src/lib/components/StatusSidebar.svelte`, reads this state and shows:

- a Skeleton `Navigation` sidebar menu with permanent navigation/actions like My profile, Item ID, Create forum, and page refresh
- a separate status pane with chain health, indexer health, and IPFS health
- a link to the dedicated IPFS status page
- Skeleton-styled form controls across the main publishing and editing flows (`input`, `textarea`, `select`, and `btn` classes) for consistent dapp theming

The dedicated status page, `src/routes/status/ipfs/+page.svelte`, is specifically for IPFS and shows:

- Helia swarm target status
- pinner queue counts
- local dial errors for the IPFS/Kubo connection

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

### Load sequence

When the route loads and Helia is ready:

1. normalize the item ID
2. call `loadContentByItemId(heliaNode, itemId, api, revisionId?)`
3. fetch latest or selected revision metadata from the indexer
4. fetch chain item state when available
5. fetch revision bytes from IPFS via Helia/UnixFS
6. decode protobuf item payload and mixins
7. render content-specific UI

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

#### 3. IPFS payload

Using the selected revision's IPFS digest, the app:

- reconstructs a CIDv0
- `cat`s bytes from Helia UnixFS
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
3. add bytes to IPFS through Helia
4. enqueue CID for local pinner ACK
5. sign and submit the chain extrinsic via extension
6. wait for finalization
7. rely on the indexer to make the new state discoverable

### Why publishing requires a local IPFS connection

`publishBytesToIpfs()` explicitly checks `hasDefaultLocalIpfsConnection()`.

The app does not treat “stored in browser Helia only” as enough. It requires a live link to the local pinner because the dapp wants published content to be acknowledged and persisted beyond the ephemeral browser node.

### CID and ACK workflow

When bytes are added to IPFS:

- the CID is added to the local `ipfsPinningQueue`
- background processes attempt to `provide` the CID on the DHT
- the app opens `/x/acuity/ack/1.0.0` to the local pinner peer
- it sends the CID and expects `ACK: received <cid>`

This ACK step is a notable part of the architecture:

- publishing is user-visible immediately
- pinning confirmation is tracked separately
- failures survive refresh because the queue is stored in local storage
- retries happen automatically when the local IPFS connection comes back

The queue UI is exposed at `/status`.

---

## Specific write flows

### 1. Create profile

Implemented mainly in `src/lib/services/profile.ts` and `MyProfilePage.svelte`.

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

The profile flow is special because the account profile pallet maps an account to a profile item ID.

### 2. Create forum

`saveForum()`:

- creates a top-level content item
- flags: `FORUM_ITEM_FLAGS = 0x00`
- no parents
- no links
- submits `content.publishItem(...)`

### 3. Create category

`saveCategory()`:

- content type is category
- parent is the forum item
- no links
- flags include category flag
- submits `content.publishItem(...)`

### 4. Create forum post

`saveForumPost()`:

- content type is forum post
- no parents
- links contain the category item ID
- flags mark item revisionable
- submits `content.publishItem(...)`

### 5. Create comment or reply

`saveComment()`:

- content type is comment
- parent is the commented item
- no links
- revisionable
- submits `content.publishItem(...)`

Replies are simply comments whose parent is another comment item.

### 6. Publish content revision

`publishContentRevision()` handles editing of revisionable content.

It verifies:

- active account owns the item
- item is revisionable

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

- `prepareForumSave()`
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
- performs optimistic UI updates
- reverts on error
- refreshes from the indexer after finalization

Right now reactions are shown under comments via `CommentItem.svelte`.

---

## Account balances

`balances.svelte.ts` watches balances for all injected accounts.

It works by:

- periodically reconciling the set of known accounts
- fetching balances directly from `system.account`
- subscribing to indexer events keyed by raw `account_id`
- refetching the balance when a relevant event appears

This is not central to content publishing, but it improves wallet/account UX in the selector.

---

## UI composition by content type

The generic item viewer renders specialized sub-components depending on decoded `contentType`.

### Forum

`ForumCategories.svelte`:

- incrementally loads categories from indexed parent-child relationships
- lets the forum owner create new categories
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

- the selected extension account
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
- IPFS pinner ACK queue

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

### IPFS/local pinner unavailable

- publishing is blocked unless the required local IPFS connection exists
- already-published content may fail to load if not retrievable from IPFS
- pending CID ACKs remain in local storage until connectivity returns

### Why the ACK queue is important

The queue decouples “user completed publish flow” from “local pinner definitely acknowledged CID”. That is a good fit for a browser dapp, where connectivity can be intermittent and the page can be refreshed at any time.

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
- `src/lib/components/StatusSidebar.svelte` — sidebar menu plus status dashboard
- `src/lib/components/AccountSelector.svelte` — wallet/account picker

### Protocol connections

- `src/lib/services/connections.svelte.ts` — chain/indexer/Helia startup
- `src/lib/services/indexer.svelte.ts` — indexer transport and subscriptions
- `src/lib/services/ipfs-local.ts` — local IPFS peer detection
- `src/lib/services/ipfs-publish.ts` — IPFS publish + local ACK protocol
- `src/lib/services/ipfs-pinning-queue.svelte.ts` — persistent ACK queue

### Content logic

- `src/lib/services/content.ts` — generic content encoding/decoding/load/save
- `src/lib/services/profile.ts` — profile-specific content flow
- `src/lib/services/reactions.ts` — reaction load/save logic
- `src/lib/services/chain-signing.ts` — generic extension signing helper

### Main UI features

- `src/lib/components/MyProfilePage.svelte`
- `src/lib/components/ForumCategories.svelte`
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
2. App has already connected to chain, indexer, and Helia.
3. User opens a category page.
4. `CategoryForumPosts.svelte` submits `saveForumPost()`.
5. `content.ts` encodes the post into protobuf item bytes.
6. `publishBytesToIpfs()` adds the bytes to Helia/UnixFS.
7. The resulting CID is queued for local pinner acknowledgement.
8. `saveForumPost()` derives an item ID from account + nonce + namespace.
9. It submits `content.publishItem(nonce, [], flags, [categoryId], [], revisionHash)`.
10. The extension signs the extrinsic.
11. The app waits for finalization.
12. The user is redirected to `/{itemId}`.
13. The viewer route queries the indexer for revision events.
14. The viewer fetches the IPFS payload via Helia.
15. The post is decoded and rendered.
16. Background ACK/provide logic advertises the CID and waits for the local pinner acknowledgement.
17. Future revisions or comments appear live through indexer subscriptions.

That sequence is representative of almost every feature in the app.

---

## In one sentence

This dapp is a **static, browser-only Svelte client** that uses a **Polkadot extension for signing**, a **Substrate node for canonical state**, an **indexer for history/discovery/live updates**, and an **in-browser Helia node plus a local IPFS pinner for content storage and availability**.
