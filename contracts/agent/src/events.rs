use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

fn emit(event: &str, data: Value) {
    let line = json!({ "standard": "lien", "version": "1.0.0", "event": event, "data": data });
    env::log_str(&format!("EVENT_JSON:{line}"));
}

pub fn offer_created(loan_id: u32, principal: U128, total_due: U128) {
    emit("offer_created", json!({ "loan_id": loan_id, "principal": principal, "total_due": total_due }));
}
pub fn funded(loan_id: u32, lender: &AccountId, amount: u128) {
    emit("funded", json!({ "loan_id": loan_id, "lender": lender, "amount": U128(amount) }));
}
pub fn activated(loan_id: u32, principal: U128) {
    emit("activated", json!({ "loan_id": loan_id, "principal": principal }));
}
pub fn cancelled(loan_id: u32) {
    emit("cancelled", json!({ "loan_id": loan_id }));
}
pub fn revenue(source: &str, amount: u128, lender: u128, operator: u128, opex: u128) {
    emit("revenue", json!({
        "source": source, "amount": U128(amount),
        "lender": U128(lender), "operator": U128(operator), "opex": U128(opex),
    }));
}
pub fn repaid(loan_id: u32, by: &AccountId, amount: u128, outstanding: u128) {
    emit("repaid", json!({ "loan_id": loan_id, "by": by, "amount": U128(amount), "outstanding": U128(outstanding) }));
}
pub fn loan_closed(loan_id: u32, status: &str) {
    emit("loan_closed", json!({ "loan_id": loan_id, "status": status }));
}
pub fn foreclosed(loan_id: u32, by: &AccountId, outstanding: u128, seized: u128) {
    emit("foreclosed", json!({ "loan_id": loan_id, "by": by, "outstanding": U128(outstanding), "seized": U128(seized) }));
}
pub fn bid(loan_id: u32, bidder: &AccountId, amount: u128, ends_at: u64) {
    emit("bid", json!({ "loan_id": loan_id, "bidder": bidder, "amount": U128(amount), "ends_at": ends_at }));
}
pub fn sold(loan_id: u32, buyer: &AccountId, price: u128, to_lenders: u128, surplus: u128) {
    emit("sold", json!({ "loan_id": loan_id, "buyer": buyer, "price": U128(price), "to_lenders": U128(to_lenders), "surplus": U128(surplus) }));
}
pub fn job_started(job_id: u64, payer: &AccountId, paid: u128) {
    emit("job_started", json!({ "job_id": job_id, "payer": payer, "paid": U128(paid) }));
}
pub fn job_done(job_id: u64) {
    emit("job_done", json!({ "job_id": job_id }));
}
pub fn job_refunded(job_id: u64, reason: &str) {
    emit("job_refunded", json!({ "job_id": job_id, "reason": reason }));
}
pub fn spent(job_id: u64, to: &AccountId, amount: u128) {
    emit("spent", json!({ "job_id": job_id, "to": to, "amount": U128(amount) }));
}
pub fn spend_blocked(job_id: u64, to: &str, amount: u128, reason: &str) {
    emit("spend_blocked", json!({ "job_id": job_id, "to": to, "amount": U128(amount), "reason": reason }));
}
pub fn proposal_opened(id: u32, loan_id: u32, wasm_hash: &str) {
    emit("proposal_opened", json!({ "proposal_id": id, "loan_id": loan_id, "wasm_hash": wasm_hash }));
}
pub fn proposal_applied(id: u32, wasm_hash: &str) {
    emit("proposal_applied", json!({ "proposal_id": id, "wasm_hash": wasm_hash }));
}
pub fn service_updated(wasm_hash: &str) {
    emit("service_updated", json!({ "wasm_hash": wasm_hash }));
}
pub fn operator_changed(from: &AccountId, to: &AccountId) {
    emit("operator_changed", json!({ "from": from, "to": to }));
}
