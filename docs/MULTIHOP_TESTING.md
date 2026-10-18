# Physical multi-hop verification

Run this after the two-device gate in `DEVICE_TESTING.md`.

1. Start the coordinator on Mac A and create a room.
2. Admit Phone A and Phone B. The default permitted graph is a star: `Phone A ↔ Mac A ↔ Phone B`.
3. Keep all three browsers foregrounded. On Phone A, select Phone B.
4. Confirm the inspector says **2-hop overlay**, the candidate pair says **not selected**, and the route preview reads `Phone A → Mac A → Phone B`.
5. Send a unique message from Phone A.
6. Capture Phone A's **Route receipt returned**, Mac A's two **Payload forwarded** events (message and receipt), and Phone B's **Routed message delivered** event.
7. Export or record browser console errors and note browser/OS versions.

This proves application-layer forwarding only when the intermediate Mac's browser actually records receiving and transmitting the envelope. It does not prove IP-layer routing or an access-point-independent mesh.
