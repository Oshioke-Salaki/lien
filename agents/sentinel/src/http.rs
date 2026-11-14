//! A POST with a hard deadline. The stock client only bounds the connect; a node that accepts and
//! then never answers would hold the whole run until the enclave's time limit. Here every wait
//! (the response head and each body chunk) races a monotonic-clock timer, so a stalled node is
//! skipped and the next provider is asked.

use std::time::Duration;
use wasi::clocks::monotonic_clock;
use wasi::http::outgoing_handler;
use wasi::http::types::{Fields, Method, OutgoingBody, OutgoingRequest, RequestOptions, Scheme};
use wasi::io::poll;
use wasi::io::streams::StreamError;

pub fn post_json(url: &str, body: &str, limit: Duration) -> Result<(u16, Vec<u8>), String> {
    post_json_auth(url, body, limit, None)
}

/// The same POST with an optional bearer token.
pub fn post_json_auth(url: &str, body: &str, limit: Duration, bearer: Option<&str>) -> Result<(u16, Vec<u8>), String> {
    let deadline = monotonic_clock::now() + limit.as_nanos() as u64;
    let rest = |what: &str| -> Result<u64, String> {
        let now = monotonic_clock::now();
        if now >= deadline { Err(format!("{what} took too long")) } else { Ok(deadline - now) }
    };
    let (scheme, after) = if let Some(r) = url.strip_prefix("https://") { (Scheme::Https, r) } else if let Some(r) = url.strip_prefix("http://") { (Scheme::Http, r) } else { return Err("bad url".into()) };
    let (authority, path) = match after.find('/') { Some(i) => (&after[..i], &after[i..]), None => (after, "/") };

    let headers = Fields::new();
    headers.append(&"content-type".to_string(), &b"application/json".to_vec()).map_err(|_| "header")?;
    if let Some(token) = bearer {
        headers.append(&"authorization".to_string(), &format!("Bearer {token}").into_bytes()).map_err(|_| "header")?;
    }
    let req = OutgoingRequest::new(headers);
    req.set_method(&Method::Post).map_err(|_| "method")?;
    req.set_scheme(Some(&scheme)).map_err(|_| "scheme")?;
    req.set_authority(Some(authority)).map_err(|_| "authority")?;
    req.set_path_with_query(Some(path)).map_err(|_| "path")?;
    let out = req.body().map_err(|_| "body")?;
    {
        let w = out.write().map_err(|_| "write")?;
        w.blocking_write_and_flush(body.as_bytes()).map_err(|_| "write failed")?;
    }
    OutgoingBody::finish(out, None).map_err(|_| "finish")?;

    let options = RequestOptions::new();
    let left = rest("the request")?;
    let _ = options.set_connect_timeout(Some(left.min(8_000_000_000)));
    let _ = options.set_first_byte_timeout(Some(left));
    let _ = options.set_between_bytes_timeout(Some(left));
    let future = outgoing_handler::handle(req, Some(options)).map_err(|_| "the chain could not be reached")?;

    // wait for the response head, or the deadline
    let response = loop {
        if let Some(r) = future.get() {
            break r.map_err(|_| "response taken")?.map_err(|_| "the chain could not be reached")?;
        }
        let timer = monotonic_clock::subscribe_duration(rest("the response")?);
        let ready = future.subscribe();
        poll::poll(&[&ready, &timer]);
    };
    let status = response.status();
    let incoming = response.consume().map_err(|_| "consume")?;
    let mut bytes = Vec::new();
    {
        let stream = incoming.stream().map_err(|_| "stream")?;
        loop {
            match stream.read(64 * 1024) {
                Ok(chunk) if !chunk.is_empty() => bytes.extend_from_slice(&chunk),
                Ok(_) => {
                    let timer = monotonic_clock::subscribe_duration(rest("the body")?);
                    let ready = stream.subscribe();
                    poll::poll(&[&ready, &timer]);
                }
                Err(StreamError::Closed) => break,
                Err(_) => return Err("the chain response could not be read".into()),
            }
        }
    }
    Ok((status, bytes))
}
