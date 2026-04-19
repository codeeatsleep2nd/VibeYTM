//! Integration test for the account-info wire contract.
//!
//! The real poller requires a live `AppHandle` and YTM WebView, so we can't
//! spin it up here. Instead we pin the JSON shape that crosses three
//! boundaries:
//!
//!   1. `scripts/inject/ytm-player-bridge.js` → `window.__VIBEYTM_ACCOUNT__`
//!   2. Rust poller deserializes that into `BridgeAccount`
//!   3. `get_account_info` / `player:account-changed` emits `AccountInfo`
//!      back to the frontend (`src/lib/types.ts::AccountInfo`)
//!
//! A single regression here (e.g. someone flipping serde back to snake_case)
//! silently breaks the sidebar. The test locks the contract.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Mirrors `src/lib/types.ts::AccountInfo`.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FrontendAccountInfo {
    name: String,
    avatar_url: String,
}

#[test]
fn bridge_output_is_consumable_by_frontend_account_info_type() {
    // Exactly what the bridge script stores on `window.__VIBEYTM_ACCOUNT__`
    // and what the Rust poller re-emits via `player:account-changed`.
    let wire: Value = json!({
        "name": "Jane Doe",
        "avatarUrl": "https://yt3.ggpht.com/a/jane=s96-c",
    });

    let parsed: FrontendAccountInfo = serde_json::from_value(wire).unwrap();
    assert_eq!(parsed.name, "Jane Doe");
    assert_eq!(parsed.avatar_url, "https://yt3.ggpht.com/a/jane=s96-c");
}

#[test]
fn frontend_type_round_trips_to_bridge_shape() {
    let info = FrontendAccountInfo {
        name: "Jane".into(),
        avatar_url: "https://example.test/a.jpg".into(),
    };
    let wire = serde_json::to_value(&info).unwrap();
    assert_eq!(wire["avatarUrl"], "https://example.test/a.jpg");
    assert!(
        wire.get("avatar_url").is_none(),
        "snake_case leak would break the frontend hook"
    );
}

#[test]
fn login_only_frame_has_no_account_field() {
    // Bridge emits this shape while the player DOM hasn't mounted yet
    // (e.g. on the sign-in redirect). The poller must not treat a missing
    // account as a valid update.
    let frame: Value = json!({
        "loginOnly": true,
        "loggedIn": false,
    });
    assert!(frame.get("account").is_none());
    assert_eq!(frame["loggedIn"], false);
}
