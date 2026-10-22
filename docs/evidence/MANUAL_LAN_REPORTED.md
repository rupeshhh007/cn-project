# User-reported physical-LAN observations

Provenance: supplied by the user in the physical-device reliability request on 22 October 2026. These are **manually reported observations**, not results produced by this development run. Original raw experimental exports were not supplied/inspected here. Preserve the reported values without inferring additional trials.

Environment: **one physical MacBook + one physical phone**, four logical browser sessions, trusted mkcert LAN HTTPS, browser WebRTC overlay. The physical phone participated as Relay Two. Other routers were browser sessions on the MacBook, not three additional physical devices.

| Observation | Baseline | Logical relay-link fault during progress |
| --- | ---: | ---: |
| Payload / receiver-confirmed bytes | 4,194,304 | 16,144,879 |
| Completion time | 14.85 seconds | 21.54 seconds |
| Chunk retries | 0 | 8 |
| SHA-256 | Reported verified | Reported verified |
| Recovery | Not observed | 99.6 ms fault-to-ACK-progress observation |

The user also reported four peers/two established overlay routes in Lab and successful message delivery plus ACK after logical-link failure.

Qualifications: payload sizes differ, so the completion times do **not** demonstrate comparative performance superiority. The 99.6 ms interval is an application-level fault-to-ACK-progress observation, not guaranteed physical network convergence. Logical fault injection is not evidence of a closed-browser failure on four independent physical devices. Final two-laptop/two-phone acceptance and repeated equal-payload comparative experiments remain pending. Do not invent file hashes, browser versions, distributions, screenshots or raw exports for these observations.
