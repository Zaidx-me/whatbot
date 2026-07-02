# Session Isolation Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `allowedSessions` enforcement so scoped API keys cannot access sessions outside their allowed list via individual session endpoints.

**Architecture:** Add a private `assertSessionAccess()` method in `SessionService` and an `allowedSessions` parameter to `findOne()`. Since most session methods internally call `this.findOne(id)` to verify the session exists, passing `allowedSessions` through to that call gives them automatic protection. Controller methods thread `apiKey?.allowedSessions` from the `@CurrentApiKey()` decorator.

**Tech Stack:** NestJS, TypeORM, Jest

## Global Constraints

- TypeScript strict mode
- Existing test patterns in `session.service.spec.ts` must be followed
- `ForbiddenException` (403) for access denial — no information leakage about which sessions exist
- No changes to `findAll()` or `getStats()` (already protected)
- No changes to MessageController or WebSocket gateway (already protected)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `whatbot/src/modules/session/session.service.ts` | Modify | Add `assertSessionAccess()`, update `findOne()` + 12 methods |
| `whatbot/src/modules/session/session.controller.ts` | Modify | Thread `apiKey?.allowedSessions` to all service calls |
| `whatbot/src/modules/session/session.service.spec.ts` | Modify | Add tests for `assertSessionAccess` and scoped access |

---

### Task 1: Add `assertSessionAccess` and update `findOne` in SessionService

**Files:**
- Modify: `whatbot/src/modules/session/session.service.ts:311-317`

**Interfaces:**
- Consumes: None (new code)
- Produces: `assertSessionAccess(sessionId, allowedSessions?)` — private method; `findOne(id, allowedSessions?)` — updated signature

- [ ] **Step 1: Add ForbiddenException import**

At the top of `session.service.ts`, add `ForbiddenException` to the existing `@nestjs/common` import:

```typescript
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  OnModuleDestroy,
  OnModuleInit,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
```

- [ ] **Step 2: Add `assertSessionAccess` private method**

Add this method anywhere in the `SessionService` class (e.g., after `attachLastError` around line 327):

```typescript
private assertSessionAccess(sessionId: string, allowedSessions?: string[] | null): void {
  if (!allowedSessions || allowedSessions.length === 0) return;
  if (!allowedSessions.includes(sessionId)) {
    throw new ForbiddenException('Access to this session is denied');
  }
}
```

- [ ] **Step 3: Update `findOne` signature and add assertion**

Change `findOne` from:

```typescript
async findOne(id: string): Promise<Session> {
  const session = await this.sessionRepository.findOne({ where: { id } });
  if (!session) {
    throw new NotFoundException(`Session with id '${id}' not found`);
  }
  return this.attachLastError(session);
}
```

To:

```typescript
async findOne(id: string, allowedSessions?: string[] | null): Promise<Session> {
  this.assertSessionAccess(id, allowedSessions);
  const session = await this.sessionRepository.findOne({ where: { id } });
  if (!session) {
    throw new NotFoundException(`Session with id '${id}' not found`);
  }
  return this.attachLastError(session);
}
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `cd whatbot && npx jest src/modules/session/session.service.spec.ts --no-coverage 2>&1 | tail -20`
Expected: All existing tests pass (some may need minor updates in Task 3 if they call `findOne` directly).

- [ ] **Step 5: Commit**

```bash
git add whatbot/src/modules/session/session.service.ts
git commit -m "feat(session): add assertSessionAccess and update findOne signature"
```

---

### Task 2: Update SessionController to pass `allowedSessions`

**Files:**
- Modify: `whatbot/src/modules/session/session.controller.ts`

**Interfaces:**
- Consumes: `SessionService.findOne(id, allowedSessions?)` from Task 1
- Produces: Controller methods pass `apiKey?.allowedSessions` to service calls

- [ ] **Step 1: Add `CurrentApiKey` import and `ApiKey` type**

Check that `CurrentApiKey` and `ApiKey` are already imported at the top of `session.controller.ts`. They should be — the existing `findAll` and `getStats` methods already use them. Verify:

```typescript
import { RequireRole, CurrentApiKey, SessionScoped } from '../auth/decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
```

- [ ] **Step 2: Update `findOne` controller method**

Change from:

```typescript
async findOne(@Param('id') id: string): Promise<SessionResponseDto> {
  const session = await this.sessionService.findOne(id);
  return this.transformSession(session);
}
```

To:

```typescript
async findOne(@Param('id') id: string, @CurrentApiKey() apiKey?: ApiKey): Promise<SessionResponseDto> {
  const session = await this.sessionService.findOne(id, apiKey?.allowedSessions);
  return this.transformSession(session);
}
```

- [ ] **Step 3: Update `delete` controller method**

Change from:

```typescript
async delete(@Param('id') id: string): Promise<void> {
  const session = await this.sessionService.findOne(id);
  await this.sessionService.delete(id);
```

To:

```typescript
async delete(@Param('id') id: string, @CurrentApiKey() apiKey?: ApiKey): Promise<void> {
  const session = await this.sessionService.findOne(id, apiKey?.allowedSessions);
  await this.sessionService.delete(id);
```

- [ ] **Step 4: Update `start` controller method**

Change from:

```typescript
async start(@Param('id') id: string): Promise<SessionResponseDto> {
  const session = await this.sessionService.start(id);
```

To:

```typescript
async start(@Param('id') id: string, @CurrentApiKey() apiKey?: ApiKey): Promise<SessionResponseDto> {
  const session = await this.sessionService.start(id, apiKey?.allowedSessions);
```

- [ ] **Step 5: Update `stop` controller method**

Change from:

```typescript
async stop(@Param('id') id: string): Promise<SessionResponseDto> {
  const session = await this.sessionService.stop(id);
```

To:

```typescript
async stop(@Param('id') id: string, @CurrentApiKey() apiKey?: ApiKey): Promise<SessionResponseDto> {
  const session = await this.sessionService.stop(id, apiKey?.allowedSessions);
```

- [ ] **Step 6: Update `forceKill` controller method**

Change from:

```typescript
async forceKill(@Param('id') id: string): Promise<SessionResponseDto> {
  const session = await this.sessionService.forceKill(id);
```

To:

```typescript
async forceKill(@Param('id') id: string, @CurrentApiKey() apiKey?: ApiKey): Promise<SessionResponseDto> {
  const session = await this.sessionService.forceKill(id, apiKey?.allowedSessions);
```

- [ ] **Step 7: Update `getQRCode` controller method**

Change from:

```typescript
async getQRCode(@Param('id') id: string): Promise<QRCodeResponseDto> {
  const qrCode = await this.sessionService.getQRCode(id);
```

To:

```typescript
async getQRCode(@Param('id') id: string, @CurrentApiKey() apiKey?: ApiKey): Promise<QRCodeResponseDto> {
  const qrCode = await this.sessionService.getQRCode(id, apiKey?.allowedSessions);
```

- [ ] **Step 8: Update `requestPairingCode` controller method**

Change from:

```typescript
async requestPairingCode(
  @Param('id') id: string,
  @Body() dto: RequestPairingCodeDto,
): Promise<PairingCodeResponseDto> {
  return this.sessionService.requestPairingCode(id, dto.phoneNumber);
}
```

To:

```typescript
async requestPairingCode(
  @Param('id') id: string,
  @Body() dto: RequestPairingCodeDto,
  @CurrentApiKey() apiKey?: ApiKey,
): Promise<PairingCodeResponseDto> {
  return this.sessionService.requestPairingCode(id, dto.phoneNumber, apiKey?.allowedSessions);
}
```

- [ ] **Step 9: Update `getGroups` controller method**

Change from:

```typescript
async getGroups(
  @Param('id') id: string,
  @Query('limit') limit?: string,
  @Query('offset') offset?: string,
): Promise<{ id: string; name: string; linkedParentJID?: string | null }[]> {
  return this.sessionService.getGroups(id, {
```

To:

```typescript
async getGroups(
  @Param('id') id: string,
  @Query('limit') limit?: string,
  @Query('offset') offset?: string,
  @CurrentApiKey() apiKey?: ApiKey,
): Promise<{ id: string; name: string; linkedParentJID?: string | null }[]> {
  return this.sessionService.getGroups(id, {
```

And add `apiKey?.allowedSessions` as the second argument to `getGroups`:

```typescript
  return this.sessionService.getGroups(id, apiKey?.allowedSessions, {
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  });
```

- [ ] **Step 10: Update `getChats` controller method**

Change from:

```typescript
async getChats(
  @Param('id') id: string,
  @Query('limit') limit?: string,
  @Query('offset') offset?: string,
): Promise<ChatSummary[]> {
  return this.sessionService.getChats(id, {
```

To:

```typescript
async getChats(
  @Param('id') id: string,
  @Query('limit') limit?: string,
  @Query('offset') offset?: string,
  @CurrentApiKey() apiKey?: ApiKey,
): Promise<ChatSummary[]> {
  return this.sessionService.getChats(id, apiKey?.allowedSessions, {
```

- [ ] **Step 11: Update `markChatRead` controller method**

Change from:

```typescript
async markChatRead(@Param('id') id: string, @Body() dto: MarkChatReadDto): Promise<{ success: boolean }> {
  const success = await this.sessionService.sendSeen(id, dto.chatId);
```

To:

```typescript
async markChatRead(@Param('id') id: string, @Body() dto: MarkChatReadDto, @CurrentApiKey() apiKey?: ApiKey): Promise<{ success: boolean }> {
  const success = await this.sessionService.sendSeen(id, dto.chatId, apiKey?.allowedSessions);
```

- [ ] **Step 12: Update `markChatUnread` controller method**

Change from:

```typescript
async markChatUnread(@Param('id') id: string, @Body() dto: MarkChatReadDto): Promise<{ success: boolean }> {
  const success = await this.sessionService.markUnread(id, dto.chatId);
```

To:

```typescript
async markChatUnread(@Param('id') id: string, @Body() dto: MarkChatReadDto, @CurrentApiKey() apiKey?: ApiKey): Promise<{ success: boolean }> {
  const success = await this.sessionService.markUnread(id, dto.chatId, apiKey?.allowedSessions);
```

- [ ] **Step 13: Update `deleteChat` controller method**

Change from:

```typescript
async deleteChat(@Param('id') id: string, @Body() dto: DeleteChatDto): Promise<{ success: boolean }> {
  const success = await this.sessionService.deleteChat(id, dto.chatId);
```

To:

```typescript
async deleteChat(@Param('id') id: string, @Body() dto: DeleteChatDto, @CurrentApiKey() apiKey?: ApiKey): Promise<{ success: boolean }> {
  const success = await this.sessionService.deleteChat(id, dto.chatId, apiKey?.allowedSessions);
```

- [ ] **Step 14: Update `sendChatState` controller method**

Change from:

```typescript
async sendChatState(@Param('id') id: string, @Body() dto: SendChatStateDto): Promise<{ success: boolean }> {
  await this.sessionService.sendChatState(id, dto.chatId, dto.state);
```

To:

```typescript
async sendChatState(@Param('id') id: string, @Body() dto: SendChatStateDto, @CurrentApiKey() apiKey?: ApiKey): Promise<{ success: boolean }> {
  await this.sessionService.sendChatState(id, dto.chatId, dto.state, apiKey?.allowedSessions);
```

- [ ] **Step 15: Compile to verify no type errors**

Run: `cd whatbot && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 16: Commit**

```bash
git add whatbot/src/modules/session/session.controller.ts
git commit -m "feat(session): pass allowedSessions from controller to service methods"
```

---

### Task 3: Update remaining SessionService methods to accept and pass `allowedSessions`

**Files:**
- Modify: `whatbot/src/modules/session/session.service.ts`

**Interfaces:**
- Consumes: `assertSessionAccess()` and `findOne(id, allowedSessions?)` from Task 1
- Produces: Updated signatures for `start`, `stop`, `delete`, `forceKill`, `getQRCode`, `requestPairingCode`, `getGroups`, `getChats`, `sendSeen`, `markUnread`, `deleteChat`, `sendChatState`

- [ ] **Step 1: Update `start` method**

Change from:

```typescript
async start(id: string): Promise<Session> {
  const session = await this.findOne(id);
```

To:

```typescript
async start(id: string, allowedSessions?: string[] | null): Promise<Session> {
  const session = await this.findOne(id, allowedSessions);
```

- [ ] **Step 2: Update `stop` method**

Change from:

```typescript
async stop(id: string): Promise<Session> {
  const session = await this.findOne(id);
```

To:

```typescript
async stop(id: string, allowedSessions?: string[] | null): Promise<Session> {
  const session = await this.findOne(id, allowedSessions);
```

- [ ] **Step 3: Update `delete` method**

Change from:

```typescript
async delete(id: string): Promise<void> {
  const session = await this.findOne(id);
```

To:

```typescript
async delete(id: string, allowedSessions?: string[] | null): Promise<void> {
  const session = await this.findOne(id, allowedSessions);
```

- [ ] **Step 4: Update `forceKill` method**

Change from:

```typescript
async forceKill(id: string): Promise<Session> {
  const session = await this.findOne(id);
```

To:

```typescript
async forceKill(id: string, allowedSessions?: string[] | null): Promise<Session> {
  const session = await this.findOne(id, allowedSessions);
```

- [ ] **Step 5: Update `getQRCode` method**

Change from:

```typescript
async getQRCode(id: string): Promise<{ qrCode: string; status: SessionStatus }> {
  const session = await this.findOne(id);
```

To:

```typescript
async getQRCode(id: string, allowedSessions?: string[] | null): Promise<{ qrCode: string; status: SessionStatus }> {
  const session = await this.findOne(id, allowedSessions);
```

- [ ] **Step 6: Update `requestPairingCode` method**

Change from:

```typescript
async requestPairingCode(id: string, phoneNumber: string): Promise<{ pairingCode: string; status: SessionStatus }> {
  const session = await this.findOne(id);
```

To:

```typescript
async requestPairingCode(id: string, phoneNumber: string, allowedSessions?: string[] | null): Promise<{ pairingCode: string; status: SessionStatus }> {
  const session = await this.findOne(id, allowedSessions);
```

- [ ] **Step 7: Update `getGroups` method**

Change from:

```typescript
async getGroups(
  id: string,
  opts: ListOptions = {},
): Promise<{ id: string; name: string; linkedParentJID?: string | null }[]> {
  await this.findOne(id); // Verify session exists
```

To:

```typescript
async getGroups(
  id: string,
  allowedSessions?: string[] | null,
  opts: ListOptions = {},
): Promise<{ id: string; name: string; linkedParentJID?: string | null }[]> {
  await this.findOne(id, allowedSessions); // Verify session exists
```

- [ ] **Step 8: Update `getChats` method**

Change from:

```typescript
async getChats(id: string, opts: ListOptions = {}): Promise<ChatSummary[]> {
  await this.findOne(id); // Verify session exists
```

To:

```typescript
async getChats(id: string, allowedSessions?: string[] | null, opts: ListOptions = {}): Promise<ChatSummary[]> {
  await this.findOne(id, allowedSessions); // Verify session exists
```

- [ ] **Step 9: Update `sendSeen` method**

Change from:

```typescript
async sendSeen(id: string, chatId: string): Promise<boolean> {
  await this.findOne(id); // Verify session exists
```

To:

```typescript
async sendSeen(id: string, chatId: string, allowedSessions?: string[] | null): Promise<boolean> {
  await this.findOne(id, allowedSessions); // Verify session exists
```

- [ ] **Step 10: Update `markUnread` method**

Change from:

```typescript
async markUnread(id: string, chatId: string): Promise<boolean> {
  await this.findOne(id); // Verify session exists
```

To:

```typescript
async markUnread(id: string, chatId: string, allowedSessions?: string[] | null): Promise<boolean> {
  await this.findOne(id, allowedSessions); // Verify session exists
```

- [ ] **Step 11: Update `deleteChat` method**

Change from:

```typescript
async deleteChat(id: string, chatId: string): Promise<boolean> {
  await this.findOne(id); // Verify session exists
```

To:

```typescript
async deleteChat(id: string, chatId: string, allowedSessions?: string[] | null): Promise<boolean> {
  await this.findOne(id, allowedSessions); // Verify session exists
```

- [ ] **Step 12: Update `sendChatState` method**

Change from:

```typescript
async sendChatState(id: string, chatId: string, state: ChatState): Promise<void> {
  await this.findOne(id); // Verify session exists
```

To:

```typescript
async sendChatState(id: string, chatId: string, state: ChatState, allowedSessions?: string[] | null): Promise<void> {
  await this.findOne(id, allowedSessions); // Verify session exists
```

- [ ] **Step 13: Compile to verify no type errors**

Run: `cd whatbot && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 14: Commit**

```bash
git add whatbot/src/modules/session/session.service.ts
git commit -m "feat(session): thread allowedSessions through all session-specific methods"
```

---

### Task 4: Add tests for session isolation

**Files:**
- Modify: `whatbot/src/modules/session/session.service.spec.ts`

**Interfaces:**
- Consumes: `SessionService.findOne(id, allowedSessions?)` from Task 1
- Produces: Test coverage for `assertSessionAccess` behavior

- [ ] **Step 1: Add test for `findOne` with unrestricted key (null allowedSessions)**

Add this test inside the existing `describe('SessionService', ...)` block, in a new `describe('allowedSessions enforcement', ...)` section:

```typescript
describe('allowedSessions enforcement', () => {
  it('findOne returns session when allowedSessions is null (unrestricted)', async () => {
    const session = createMockSession({ id: 'sess-1' });
    (repository.findOne as jest.Mock).mockResolvedValue(session);

    const result = await service.findOne('sess-1', null);

    expect(result.id).toBe('sess-1');
  });

  it('findOne returns session when allowedSessions is empty (unrestricted)', async () => {
    const session = createMockSession({ id: 'sess-1' });
    (repository.findOne as jest.Mock).mockResolvedValue(session);

    const result = await service.findOne('sess-1', []);

    expect(result.id).toBe('sess-1');
  });

  it('findOne returns session when session is in allowedSessions', async () => {
    const session = createMockSession({ id: 'sess-1' });
    (repository.findOne as jest.Mock).mockResolvedValue(session);

    const result = await service.findOne('sess-1', ['sess-1', 'sess-2']);

    expect(result.id).toBe('sess-1');
  });

  it('findOne throws ForbiddenException when session is not in allowedSessions', async () => {
    await expect(service.findOne('sess-forbidden', ['sess-1', 'sess-2'])).rejects.toThrow(ForbiddenException);
    await expect(service.findOne('sess-forbidden', ['sess-1', 'sess-2'])).rejects.toThrow('Access to this session is denied');
  });

  it('findOne does not query DB when session is not in allowedSessions', async () => {
    await service.findOne('sess-forbidden', ['sess-1']).catch(() => {});

    expect(repository.findOne).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Import ForbiddenException in the test file**

Add to the existing `@nestjs/common` import at line 4:

```typescript
import { NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
```

- [ ] **Step 3: Run the new tests**

Run: `cd whatbot && npx jest src/modules/session/session.service.spec.ts -t "allowedSessions enforcement" --no-coverage 2>&1 | tail -20`
Expected: 5 tests pass.

- [ ] **Step 4: Run the full session service test suite**

Run: `cd whatbot && npx jest src/modules/session/session.service.spec.ts --no-coverage 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add whatbot/src/modules/session/session.service.spec.ts
git commit -m "test(session): add allowedSessions enforcement tests for findOne"
```

---

### Task 5: Verify end-to-end and run full test suite

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

Run: `cd whatbot && npx jest --no-coverage 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 2: TypeScript compile check**

Run: `cd whatbot && npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 3: Final commit (if any fixups needed)**

If any fixes were needed in steps 1-2, commit them:

```bash
git add -A
git commit -m "fix(session): address review feedback for session isolation"
```
