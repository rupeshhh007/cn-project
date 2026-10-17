# Review-1 Legacy Demonstration Archive

This directory preserves the exact, self-contained implementation submitted and demonstrated for **Review 1**:
- Zero external npm dependencies (pure Node.js standard libraries).
- Monolithic server: `proxy-app.js` serving `client.html` on port 8080.
- Synthetic protected endpoint `/api/request` verifying in-memory token bucket rate limiting on derived SHA-256 observation signatures.

## Running the Review-1 Demo
```bash
# Start Review-1 server
node legacy/review1/proxy-app.js

# Run in-memory unit tests
node legacy/review1/tests/unit-test.js

# Run mock HTTP integration tests
node legacy/review1/tests/mock-http-test.js

# Run automated IP-rotation load test (against running server)
node legacy/review1/tests/load-test.js
```
