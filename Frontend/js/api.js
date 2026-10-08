/**
 * EDESK STATIONERY - API helper
 * Talks to the PHP backend (session-cookie based auth).
 */
const API = {
  authBase: '../Backend/auth/',
  apiBase: '../Backend/api/',

  async _request(url, method = 'GET', data = null) {
    const opts = {
      method,
      credentials: 'include',
      headers: {},
    };
    if (data !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(data);
    }
    let res, json;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      return { success: false, message: 'Could not reach the server. Check your connection.' };
    }
    try {
      json = await res.json();
    } catch (e) {
      return { success: false, message: 'Unexpected server response.' };
    }
    return json;
  },

  get(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const sep = qs ? '?' + qs : '';
    return this._request(this.apiBase + path + sep, 'GET');
  },
  post(path, data) { return this._request(this.apiBase + path, 'POST', data); },
  put(path, data) { return this._request(this.apiBase + path, 'PUT', data); },
  del(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const sep = qs ? '?' + qs : '';
    return this._request(this.apiBase + path + sep, 'DELETE');
  },

  auth(path, data) { return this._request(this.authBase + path, 'POST', data); },
};
