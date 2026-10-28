# Resilience Studio browser QA

Environment: production `npm start`, Chrome through the repository's Playwright configuration at `http://127.0.0.1:4173`. The in-app browser was attempted on 20 October; opening localhost timed out and reset its kernel. Playwright is the verified fallback, with direct inspection of saved renders. Loopback's secure-context behavior is not evidence of physical LAN certificate trust.

The walkthrough creates admitted browser peers with actual channels, sends and acknowledges a visible conversation, accepts and verifies files, starts Lab trials, downloads/parses JSON and CSV, applies a host-controlled logical fault, and scrubs/steps/plays recorded state. The acceptance sizes are 1920×1080, 1440×900, 1280×720, 768×1024, 430×932 and 390×844, plus the concept's native 1586×992 size.

## Evidence map

| State | Actual capture |
| --- | --- |
| Entry, empty room, admission pending | `screenshots/studio/entry.png`, `empty-room.png`, `pending-admission.png` |
| Two connected peers and diagnostics | `screenshots/hopnet-phase0-live-desktop.png` |
| Five admitted browser peers | `screenshots/studio/five-browser-peers.png` |
| Conversation and receiver delivery | `screenshots/studio/send-conversation.png` |
| Receiver consent | `screenshots/studio/incoming-offer.png` |
| Active transfer after relay closure | `screenshots/hopnet-resilience-active.png` |
| Receiver-verified completion | `screenshots/hopnet-resilience-recovered.png` |
| No-alternate-route failure | `screenshots/hopnet-no-alternate-failure.png` |
| Active Lab logical recovery | `screenshots/studio/lab-active-recovery.png` |
| Lab measured result | `screenshots/studio/lab-result.png` |
| Space and selected-event Replay at desktop/tablet sizes | `screenshots/studio/space-WxH.png`, `replay-WxH.png` |
| Mobile conversation and Activity/Replay | `screenshots/studio/messages-390x844.png`, `messages-430x932.png`, matching replay captures |

Invitation QR images are deliberately masked in public captures. Capture existence does not by itself establish visual acceptance; inspect the images and their associated test results.

## Checks and corrections

- Dedicated Send, Lab and Replay replace the earlier input-focus action and Space overlays. No historical graph is drawn from current live state.
- Conversation and transfer results are visible in their task workspace. Mobile conversations appear before completed transfer history; navigation and the composer reserve safe-area space.
- Actual measured board dimensions drive SVG paths; endpoints meet plinth perimeters rather than device screens. Selection lifts only the hardware, keeping its plinth and route anchor stationary. Replay maps its SVG to the same percent coordinates as the historical devices, without square-viewBox letterboxing. Automated geometry checks compare live endpoints with plinth bounds and historical endpoints with recorded node centers.
- A closed inspector stays closed. Informational rows no longer show fake action chevrons. Clipboard failure has an actionable visible result. Attachment inputs invoke real file selection.
- A five-peer test exposed obsolete close reports after host link revocation, and their error toast covered navigation at 1280×720. Reports for removed edges are now suppressed, expected late close notifications are ignored, and desktop errors are positioned away from navigation. Overlay inspectors do not reuse a closed direct link's RTT/candidate as if it measured the current path.
- Keyboard focus rings are visible, mobile visual-viewport changes move the composer, and Motion respects reduced-motion preferences. Physical on-screen keyboard testing remains pending.
- Automated checks assert horizontal overflow absence and center-point hit testing for enabled controls in the visible, unclipped region. Controls outside a scroll container's visible clipping region are not incorrectly treated as covered buttons; actual workflow clicks scroll their target into view.
- Captures are taken after the peer inspector reaches full opacity. This avoids treating a transient spring/fade frame as a finished visual.
- Decorative cutouts cannot intercept another peer's clicks through transparent padding. Grid intrinsic sizing is avoided with definite contained image frames. The short-screen layout keeps the top phone clear of the headline. Space shows active/latest transfer state; full bounded history remains in Send. Replay's legend sits below the graph, not over mobile peer labels.
- Page identity, meaningful content, runtime page errors and successful interaction results are asserted. HTTP failures and physical Safari/Android console behavior remain hardware/browser checks, not inferred passes.

## Reference comparison and remaining acceptance

The supplied references establish blue/lavender atmosphere, dimensional devices, luminous plinths, restrained glass and readable task hierarchy. A refinement concept is saved at `design/spatial-refinement-concept.png`. It is generated design art, **not live evidence**. The implementation retains this direction while replacing the earlier overly bold, small typography and neon-like device wallpapers. Empty rooms show only the real local device, so they intentionally cannot reproduce a reference containing five decorative peers. The browser tests create five actual peers for that comparison.

The implementation has dedicated task surfaces and substantially more constrained panel placement, but a claim of pixel-identical reference matching is not made. Human visual acceptance, physical Safari/Android testing, real keyboard behavior and background-suspension behavior remain pending. The user should review the actual screenshots and run `DEVICE_TESTING.md` before the final demonstration.

## Refinement fidelity ledger

| Comparison | Mismatch observed | Repair / intentional difference |
| --- | --- | --- |
| Typography | Heavy Avenir-style headings; 8–10px protocol metadata | Local OFL Instrument Sans variable, regular/medium hierarchy and explicit control sizing; offline font loading is asserted in the browser |
| Materials / palette | Large opaque oval overwhelmed the atmospheric room | Text-free generated blue/lavender silk background, low-opacity stage, light frosted inspector and restrained white edge highlights |
| Device treatment | Tiny hardware with neon streak wallpapers | New genuine-alpha laptop/phone cutouts with calm folded-glass wallpapers; bounded contain frames keep hardware on its plinth; originals preserved |
| Route geometry | Selection moved a pad away from the curve; Replay SVG could letterbox | Fixed plinth anchors, hardware-only lift, actual live canvas dimensions and percent-mapped Replay SVG, with endpoint regression assertions |
| Navigation / interaction | Independent opaque pills and abrupt selection | One spring-driven shared selection surface, native buttons and visible focus; reduced-motion respected |
| Copy / truth | Decorative reference shows illustrative peers, RTT and delivery | Peer names, route availability, bytes, RTT and receipts come from actual state. No concept metrics imported. Empty conversation says “A conversation with”, not an inaccurate claim of a direct link |
| Required working tools | Reference inspector has only a few illustrative rows | File consent, signatures, failure feedback, Lab controls and protocol evidence intentionally extend the reference; these stay native and scrollable |

Above-the-fold copy retains the supplied wordmark/tagline, four workspace names and command heading. Dynamic peer/status/event copy is intentionally state-dependent. Native protocol and experimental fields are workflow-required deviations, not invented promotional copy. Human acceptance of the final visual style remains pending; pixel identity is not claimed.

Design references inspected: [Apple](https://www.apple.com/), [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/), [ChatGPT](https://chatgpt.com/), [Bencho tab bar](https://bencho.dev/blocks/tab-bar), [Bencho graph](https://bencho.dev/blocks/blast-radius), [Rare UI fluid orb](https://www.rareui.com/components/fluidorb), [Instrument Sans](https://github.com/Instrument/instrument-sans) and [Motion](https://motion.dev/). Applied patterns are task-focused navigation, a conversation-first composer, disclosed protocol detail, selected-state continuity and restrained feedback. No Bencho/Rare UI source was copied; the original implementation uses existing Motion, without adding UI-library or WebGL dependencies. Generated asset prompts and saved paths are recorded in `design/REFINEMENT.md`.
