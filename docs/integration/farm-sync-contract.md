# Farm synchronization and local drafts

The `/fields` UI now uses this contract for confirmed field synchronization,
owner-scoped recovery and assistant context. The v3 optimizer and full end-to-end
acceptance remain pending; synchronization does not imply calculation readiness.

## Server contract

All farm routes require the existing verified-user dependency. Owner IDs come from
authentication and cannot be supplied by the client. The optional `X-Workspace-Owner`
header checks that the captured UI account still matches the authenticated account;
a mismatch returns 409. It never grants access to a different owner.

- `GET /field-shift/farms`: owned current farm headers.
- `GET /field-shift/farms/{id}`: header plus fields in its current partition.
- `POST /field-shift/farms/sync`: a farm header and independently validated field forms.

```json
{
  "idempotency_key": "unique-attempt-id",
  "farm": {
    "local_id": "stable-browser-farm-id",
    "name": "North farm",
    "geometry": {"type": "Polygon", "coordinates": []},
    "partition_revision": "stable-confirmed-partition-id",
    "expected_version": null
  },
  "fields": [
    {"local_id": "stable-browser-field-id", "expected_version": null, "field": {}}
  ]
}
```

The empty geometry/form above illustrate shape only and are intentionally not valid
submission data. Each `field` is the existing complete FieldInput including a boundary.

Response includes `farm`, `items` and `complete`. Each item carries `local_id`,
`status` (`synced`, `invalid`, `conflict`), saved `field` or null, and an error or null.
`complete` refers only to the submitted batch; the UI must also count unsubmitted,
incomplete local fields before claiming the entire farm is synchronized or ready.

Farm identity is unique by owner + local ID. Field identity is unique by server farm +
partition revision + local ID. Retry the identical request with the identical key after
an uncertain response; it returns the frozen receipt. Reusing that key with altered
inputs returns 409. After correcting partial errors, use a new attempt key. Identical
successful siblings return their existing records; changed existing records require
`expected_version`. An old replay receipt can contain an old field version: reload
current server state before editing or treating it as the latest snapshot.

Farm geometry/name/partition changes require its current version. New partitions create
new field identities and retain old fields for historical references. Current farm reads
exclude older partitions. Legacy field detail reads remain available; legacy edits cannot
modify archived partition fields. Legacy field-list results still include archived fields;
the integration UI must use farm partition metadata to distinguish them.

The farm ID is the initial stable resource group ID. Resource definitions and freezing the
farm/resource group into v3 optimizer snapshots are subsequent implementation work.

## Geometry invariants

Managed boundaries use WGS84 Polygon, including valid holes (up to 20 rings and 2000
coordinate positions). AOI queries retain their existing single-ring/200-vertex contract.
The server rejects invalid geometry, crossing the antimeridian, field coordinates outside
the polygon, fields outside their farm, and overlapping active partition fields. A 1%
area tolerance accommodates spherical versus ellipsoidal measurements; persisted area is
the WGS84 geodesic value. Holes are subtracted regardless of supplied winding direction.

Existing standalone fields retain their previous API semantics. Managed fields edited
through the old PATCH endpoint receive the same farm, area and overlap checks as sync.

## Database migration

`foundation_0017_farms` adds farm and sync-receipt tables, nullable field identity links
and uniqueness/FK constraints. Existing field records do not need a farm and are not
rewritten. Apply normal Alembic migration before starting code with these ORM columns.
The application database has not been migrated in this stage.

Verification used a fresh dedicated database, upgraded to 0016, inserted a legacy field
at version 7 with history, upgraded to 0017, downgraded to 0016 and upgraded again. The
legacy version/history remained intact. The isolated test DB is recorded in evidence.

## Browser storage

IndexedDB `field-shift-workspace` version 3 adds scoped stores. It never deletes/recreates
legacy `farms`, `fields`, or `observations`, including unrecognized v1 prototype records.
`getLegacyWorkspace()` returns both recognized draft features and the original raw archive.

`getStoredWorkspace(ownerId)` / `replaceStoredWorkspace(..., ownerId)` use explicit captured
owner scopes; omitted/null owner means anonymous. Owner-labelled records cannot be written
into a different scope. Observations are similarly scoped by owner and field.

`importLocalWorkspace(ownerId, 'legacy' | 'anonymous')` is an explicit atomic copy. It assigns
new local farm/field IDs, rewires local relationships, clears backend links and preserves
original data. Repeating an import does not overwrite a previously copied farm. Later edits
to that source farm are not merged automatically. The `/fields` synchronization panel exposes explicit import and raw-archive export.
Copies also clear pending receipt bodies/keys and synchronization errors.


## UI recovery and partition metadata

An optional `farm.partition` stores method, orientation, requested/generated counts,
regular-grid dimensions and boundary source. A server farm with only one saved field
out of four still declares four expected fields. A second device cannot recover the
other three unsent boundaries; the UI explains that they remain on the original device.

`OwnedWorkspace` writes each attempted request durably before issuing the POST. Network
or server uncertainty retains that exact request for retry, even if the user has since
edited the form. A definitive 4xx rejection clears the pending receipt and displays the
error. Newer local edits survive a successful older receipt. Current server state is
reloaded after receipt reconciliation; the receipt is not treated as a live snapshot.

Remote conflicts never silently overwrite local changes. After reviewing the server
version, adopting it creates a separately named, unlinked local copy of the previous
farm and fields. The copy cannot replay old synchronization keys into another partition.

Field names/details and backend IDs survive map selection and coordinate rounding.
Temporary AOI uses separate map layers and selection APIs. The real mobile polygon
check in `output/evidence/fields-bot-v3/aoi-field-isolation.json` confirms no change to
permanent field version, geometry or data.
