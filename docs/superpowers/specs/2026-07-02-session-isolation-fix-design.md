# Session Isolation Fix — Service-Level Access Guard

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Fix `allowedSessions` enforcement on individual session routes

## Problem

Scoped API keys (with `allowedSessions` set) can access any session by UUID through individual session endpoints (`findOne`, `start`, `stop`, `delete`, `getQRCode`, etc.). Only `findAll` and `getStats` enforce the restriction.

**Root cause:** `SessionService.findOne()` and other session-specific methods do not check `allowedSessions`. The `ApiKeyGuard` validates the key and passes `sessionId` to `validateApiKey`, but the guard only rejects if the session is missing from `allowedSessions` — and this check works correctly for routes with `:id`/`:sessionId` params. However, the service methods themselves don't enforce the restriction, so a valid key with `allowedSessions: ['sess-A']` can call `findOne('sess-B')` and get the full session object.

## Affected Endpoints

| Endpoint | Currently Protected | Gap |
|---|---|---|
| `GET /sessions` (list) | ✅ `findAll()` filters | None |
| `GET /sessions/stats/overview` | ✅ `getStats()` filters | None |
| `GET /sessions/:id` | ❌ `findOne()` returns any | **Gap** |
| `POST /sessions/:id/start` | ❌ `start()` no check | **Gap** |
| `POST /sessions/:id/stop` | ❌ `stop()` no check | **Gap** |
| `DELETE /sessions/:id` | ❌ `delete()` no check | **Gap** |
| `GET /sessions/:id/qr` | ❌ `getQRCode()` no check | **Gap** |
| `POST /sessions/:id/pairing-code` | ❌ `requestPairingCode()` no check | **Gap** |
| `GET /sessions/:id/groups` | ❌ `getGroups()` no check | **Gap** |
| `GET /sessions/:id/chats` | ❌ `getChats()` no check | **Gap** |
| `POST /sessions/:id/chats/read` | ❌ `sendSeen()` no check | **Gap** |
| `POST /sessions/:id/chats/unread` | ❌ `markUnread()` no check | **Gap** |
| `POST /sessions/:id/chats/delete` | ❌ `deleteChat()` no check | **Gap** |
| `POST /sessions/:id/chats/typing` | ❌ `sendChatState()` no check | **Gap** |
| `POST /sessions/:id/force-kill` | ❌ `forceKill()` no check | **Gap** |
| Messages (`/sessions/:sessionId/*`) | ✅ Guard validates | None |
| WebSocket subscriptions | ✅ `isSessionSubscriptionAllowed()` | None |

## Solution

### Approach: Service-Level Guard

Add a private `assertSessionAccess(sessionId, allowedSessions?)` method in `SessionService`. Call it at the top of every session-specific method that takes a session ID.

### Implementation

#### 1. `SessionService` — add assertion method

```typescript
private assertSessionAccess(sessionId: string, allowedSessions?: string[] | null): void {
  if (!allowedSessions || allowedSessions.length === 0) return;
  if (!allowedSessions.includes(sessionId)) {
    throw new ForbiddenException('Access to this session is denied');
  }
}
```

- Unrestricted keys (null/empty `allowedSessions`) pass through
- Scoped keys are checked against the list
- Throws `ForbiddenException` (403) on violation

#### 2. `SessionService` — add `allowedSessions` parameter to affected methods

Each method gains an optional `allowedSessions` parameter. The assertion is called before any business logic.

Methods to update:
- `findOne(id, allowedSessions?)`
- `start(id, allowedSessions?)`
- `stop(id, allowedSessions?)`
- `delete(id, allowedSessions?)`
- `getQRCode(id, allowedSessions?)`
- `requestPairingCode(id, phoneNumber, allowedSessions?)`
- `getGroups(id, allowedSessions?, opts?)`
- `getChats(id, allowedSessions?, opts?)`
- `sendSeen(id, chatId, allowedSessions?)`
- `markUnread(id, chatId, allowedSessions?)`
- `deleteChat(id, chatId, allowedSessions?)`
- `sendChatState(id, chatId, state, allowedSessions?)`
- `forceKill(id, allowedSessions?)`

#### 3. `SessionController` — pass `apiKey.allowedSessions`

Each controller method already has access to `@CurrentApiKey() apiKey`. Thread `apiKey?.allowedSessions` to the corresponding service method.

Example:
```typescript
async findOne(@Param('id') id: string, @CurrentApiKey() apiKey?: ApiKey): Promise<SessionResponseDto> {
  const session = await this.sessionService.findOne(id, apiKey?.allowedSessions);
  return this.transformSession(session);
}
```

#### 4. No changes needed to

- `findAll()` — already filters by `allowedSessions`
- `getStats()` — already filters by `allowedSessions`
- Message controller — already protected by guard via `:sessionId`
- WebSocket gateway — already protected by `isSessionSubscriptionAllowed`
- `AuthService` — validation logic is correct

### Error Handling

- `ForbiddenException` (403) with message: `"Access to this session is denied"`
- Consistent with existing guard behavior
- No information leakage about which sessions exist

### What Stays the Same

- API key creation/validation flow
- `allowedSessions` field on `ApiKey` entity
- Admin dashboard key management
- `findAll`/`getStats` filtering
- WebSocket session subscription checks
- Message controller session scoping

## Testing

1. Create two API keys: `key-A` with `allowedSessions: ['session-1']`, `key-B` with `allowedSessions: ['session-2']`
2. Verify `key-A` can access `session-1` via all endpoints
3. Verify `key-A` gets 403 on `session-2` via `findOne`, `start`, `stop`, `delete`
4. Verify `key-B` can access `session-2` but gets 403 on `session-1`
5. Verify unrestricted key (null `allowedSessions`) can access all sessions
6. Verify existing `findAll` still filters correctly
7. Run existing test suite to ensure no regressions
