# ADR 0005: Process-Wide Authentication Gate

- Status: accepted
- Date: 2026-08-19

## Context

Desktop App must require Huaxiaozhu authentication before any main Shell window
is entered. Shell and Agent are separate renderer processes. Authentication must
be globally available to both without exposing bearer or refresh tokens to a
renderer. External Apps, browser panes, and background-service authorization are
outside this change.

The authentication API is rooted at
`https://api-aidp.hxsyai.com/v1`. Version 1 supports Chinese-mainland mobile
numbers and SMS verification-code login only. Password login remains visible but
disabled.

## Domain model

`AuthService` is the process-wide authority. Its externally visible state is one
of:

- `checking`: stored credentials are being restored and refreshed;
- `unauthenticated`: Login may be attempted;
- `authenticated`: a token pair and mobile identity are available;
- `authenticating`: a Login request is in flight.

The service owns access and refresh tokens, Login/Logout transitions, one
in-flight refresh operation, SMS resend deadlines, and authenticated requests.
Renderers receive only a non-secret `AuthState` projection.

Credentials consist of access token, refresh token, and server expiry metadata.
They are global rather than workspace-scoped and are stored in the existing
encrypted `credentials.enc` store. Last successful mobile number is ordinary
user preference data and is stored unencrypted in `preferences.json`.

## Decision

### Window gate

Add one dedicated Auth `BrowserWindow`, renderer entry, and least-privilege
preload. When no valid session exists, all managed Shell windows are closed and
exactly one Auth window is open. Login success closes Auth window and creates one
normal Shell window for the last-focused valid workspace, falling back to first
or newly created default workspace. Existing multi-window state is not restored.

Logout closes all Shell windows without preserving a new window snapshot, calls
remote Logout on a best-effort basis, clears local credentials, then opens Auth
window. Closing Auth window quits App. Second-instance launches and deep links
are ignored while unauthenticated except for focusing Auth window.

Background server, messaging, updater, and External App initialization remain
unchanged. Gate protects entry UI only in this version.

### API behavior

Requests use fixed values:

- `user_type: "user"`;
- `client_type: "desktop"`;
- SMS channel;
- Login business type;
- `login_type: "valid_code"`.

Mobile numbers must match `^1[3-9]\\d{9}$`. Verification codes must contain six
digits. Successful Login also requires `registered === true`.

At every App start, a stored refresh token is refreshed unconditionally before
main-window entry. Runtime authenticated requests refresh only after HTTP `401`
or response business code `401`, then retry once. Refresh is single-flight. Any
startup refresh failure clears credentials and displays Login. No proactive
expiry timer exists.

`authenticatedRequest` accepts only relative paths beneath the fixed API root.
Absolute URLs and cross-origin requests are rejected. This prevents a renderer
from directing main process to disclose bearer tokens to another origin.

### Renderer contract

Auth IPC is available only to Auth preload, Shell preload, and Agent bootstrap
preload. It is not exposed to App Host, External Apps, or browser panes. Main
process validates sender ownership for every channel.

Public capabilities are:

- read and subscribe to `AuthState`;
- send SMS code;
- Login;
- Logout;
- issue a constrained authenticated request.

Agent React code consumes this through `AuthProvider` and `useAuth`. No renderer
API returns raw access or refresh tokens.

### Login UI

Auth window defaults to `1080×680`, has minimum `800×600`, is resizable and
centered. Layout uses current UI primitives and theme tokens:

- width at least 1000px: left form 52%, right Hero 48%;
- smaller width: hide Hero and center form;
- left: current symbol, Huaxiaozhu welcome copy, disabled password Tab, active
  code-login Tab, mobile input, code input/send action, Login action, mandatory
  agreement checkbox;
- right: plain token-derived color placeholder, replaceable by future image;
- no Shell tabs or navigation.

SMS send succeeds into a process-wide 60-second cooldown. Failed requests do not
start cooldown. Agreement is required for Login but not SMS send. Agreement URL
does not exist; clicking text shows a local unavailable message. Last mobile is
remembered; code and agreement are not. UI is Chinese-only.

## Invariants

- Auth window count is zero or one.
- Auth window and Shell windows are never intentionally visible together.
- Unauthenticated state has no locally retained token pair.
- Refresh token never crosses IPC.
- Exactly one refresh request may be active.
- Authenticated requests cannot escape fixed API origin/root.
- Password Login cannot be activated or submitted.
- External App renderers receive no Auth capability.

## Consequences

- Authentication state remains consistent across Shell and Agent renderers.
- Token storage and HTTP authorization stay outside renderer compromise boundary.
- Login/logout changes window lifecycle and requires explicit coordination with
  App activation, second-instance, and window-all-closed behavior.
- UI-only gating does not yet stop background business services while logged out.
- Real SMS/API calls remain manual integration work; automated tests mock HTTP,
  time, credentials, and Electron windows.
