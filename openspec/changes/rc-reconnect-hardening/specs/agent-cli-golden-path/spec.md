## ADDED Requirements

### Requirement: An authenticated RC lifecycle matrix gates a Claude CLI pin promotion

Before Podbay records or promotes an image with a changed Claude Code pin, the exact candidate version
SHALL pass an authenticated interactive Remote Control lifecycle matrix on a designated test pod. The
matrix SHALL complement the unauthenticated sign-in golden path; it SHALL NOT put owner credentials in
CI or a scratch image.

The matrix SHALL cover pod-agent-only restart, graceful Claude restart, forced Claude restart, Incus
Suspend/wake, and image Update/recreate. Each row SHALL record whether the local conversation resumed,
whether the prior RC identity reattached or a replacement appeared, whether RC became reachable, and
whether an owner-set title was preserved or a replacement received the pod title.

#### Scenario: Candidate pin passes both gates

- **GIVEN** a new exact Claude Code version is proposed for the pod-base image
- **WHEN** its real-CLI sign-in golden path passes and every authenticated RC matrix row satisfies the
  RC lifecycle requirements
- **THEN** the pin MAY proceed to image build and real-image verification with the evidence recorded

#### Scenario: RC regression blocks promotion

- **GIVEN** the unauthenticated sign-in path passes on a candidate Claude version
- **WHEN** any authenticated RC matrix row loses the local conversation, cannot recover through the
  documented interactive path, or clobbers an owner title on the same RC session
- **THEN** Podbay SHALL keep the prior pin/image, record the failing row, and SHALL NOT substitute an
  undocumented daemon or private API workaround

#### Scenario: Test-pod mutation is bounded and reversible

- **GIVEN** the matrix temporarily changes the Claude version or stops processes on a designated test
  pod
- **WHEN** the matrix completes or aborts
- **THEN** it SHALL preserve the pod's workspace, record the prior version, and restore that version if
  the candidate is not promoted

#### Scenario: External session identity is proven only on real infrastructure

- **GIVEN** fake-provider and unit tests simulate RC outcomes without an Anthropic account
- **WHEN** release evidence is evaluated
- **THEN** only the authenticated designated-test-pod matrix SHALL be accepted as evidence that the
  broker session or Claude app reconnects
