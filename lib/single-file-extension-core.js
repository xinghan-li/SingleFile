(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.extension = {}));
})(this, (function (exports) { 'use strict';

	/*
	 * Copyright 2010-2020 Gildas Lormeau
	 * contact : gildas.lormeau <at> gmail.com
	 * 
	 * This file is part of SingleFile.
	 *
	 *   The code in this file is free software: you can redistribute it and/or 
	 *   modify it under the terms of the GNU Affero General Public License 
	 *   (GNU AGPL) as published by the Free Software Foundation, either version 3
	 *   of the License, or (at your option) any later version.
	 * 
	 *   The code in this file is distributed in the hope that it will be useful, 
	 *   but WITHOUT ANY WARRANTY; without even the implied warranty of 
	 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero 
	 *   General Public License for more details.
	 *
	 *   As additional permission under GNU AGPL version 3 section 7, you may 
	 *   distribute UNMODIFIED VERSIONS OF THIS file without the copy of the GNU 
	 *   AGPL normally required by section 4, provided you include this license 
	 *   notice and a URL through which recipients can access the Corresponding 
	 *   Source.
	 */

	/* global browser, fetch, TextDecoder */

	let contentScript, frameScript;

	const contentScriptFiles = [
		"lib/web-stream.js",
		"lib/chrome-browser-polyfill.js",
		"lib/single-file.js"
	];

	const frameScriptFiles = [
		"lib/chrome-browser-polyfill.js",
		"lib/single-file-frames.js"
	];

	const basePath = "../../../";

	async function inject(tabId, options) {
		await initScripts(options);
		let scriptsInjected;
		if (!options.removeFrames) {
			try {
				await browser.tabs.executeScript(tabId, { code: frameScript, allFrames: true, matchAboutBlank: true, runAt: "document_start" });
				// eslint-disable-next-line no-unused-vars
			} catch (error) {
				// ignored
			}
		}
		try {
			await browser.tabs.executeScript(tabId, { code: contentScript, allFrames: false, runAt: "document_idle" });
			scriptsInjected = true;
			// eslint-disable-next-line no-unused-vars
		} catch (error) {
			// ignored
		}
		if (scriptsInjected) {
			if (options.frameId) {
				await browser.tabs.executeScript(tabId, { code: "document.documentElement.dataset.requestedFrameId = true", frameId: options.frameId, matchAboutBlank: true, runAt: "document_start" });
			}
		}
		return scriptsInjected;
	}

	async function initScripts(options) {
		const extensionScriptFiles = options.extensionScriptFiles || [];
		if (!contentScript && !frameScript) {
			[contentScript, frameScript] = await Promise.all([
				getScript(contentScriptFiles.concat(extensionScriptFiles)),
				getScript(frameScriptFiles)
			]);
		}
	}

	async function getScript(scriptFiles) {
		const scriptsPromises = scriptFiles.map(async scriptFile => {
			if (typeof scriptFile == "function") {
				return "(" + scriptFile.toString() + ")();";
			} else {
				const scriptResource = await fetch(browser.runtime.getURL(basePath + scriptFile));
				return new TextDecoder().decode(await scriptResource.arrayBuffer());
			}
		});
		let content = "";
		for (const scriptPromise of scriptsPromises) {
			content += await scriptPromise;
		}
		return content;
	}

	/*
	 * Copyright 2010-2020 Gildas Lormeau
	 * contact : gildas.lormeau <at> gmail.com
	 * 
	 * This file is part of SingleFile.
	 *
	 *   The code in this file is free software: you can redistribute it and/or 
	 *   modify it under the terms of the GNU Affero General Public License 
	 *   (GNU AGPL) as published by the Free Software Foundation, either version 3
	 *   of the License, or (at your option) any later version.
	 * 
	 *   The code in this file is distributed in the hope that it will be useful, 
	 *   but WITHOUT ANY WARRANTY; without even the implied warranty of 
	 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero 
	 *   General Public License for more details.
	 *
	 *   As additional permission under GNU AGPL version 3 section 7, you may 
	 *   distribute UNMODIFIED VERSIONS OF THIS file without the copy of the GNU 
	 *   AGPL normally required by section 4, provided you include this license 
	 *   notice and a URL through which recipients can access the Corresponding 
	 *   Source.
	 */

	/* global browser, window, document, CustomEvent */

	const FETCH_SUPPORTED_REQUEST_EVENT = "single-file-request-fetch-supported";
	const FETCH_SUPPORTED_RESPONSE_EVENT = "single-file-response-fetch-supported";
	const FETCH_REQUEST_EVENT = "single-file-request-fetch";
	const FETCH_RESPONSE_EVENT = "single-file-response-fetch";
	const ERR_HOST_FETCH = "Host fetch error (SingleFile)";
	const USE_HOST_FETCH = Boolean(window.wrappedJSObject);

	const fetch$1 = window.fetch.bind(window);

	let requestId = 0, pendingResponses = new Map(), hostFetchSupported;

	browser.runtime.onMessage.addListener(message => {
		if (message.method == "singlefile.fetchFrame" && window.frameId && window.frameId == message.frameId) {
			return onFetchFrame(message);
		}
		if (message.method == "singlefile.fetchResponse") {
			return onFetchResponse(message);
		}
	});

	async function onFetchFrame(message) {
		try {
			const response = await fetch$1(message.url, { cache: "force-cache", headers: message.headers, referrerPolicy: "strict-origin-when-cross-origin" });
			return {
				status: response.status,
				headers: [...response.headers],
				array: Array.from(new Uint8Array(await response.arrayBuffer()))
			};
		} catch (error) {
			return {
				error: error && (error.message || error.toString())
			};
		}
	}

	async function onFetchResponse(message) {
		const pendingResponse = pendingResponses.get(message.requestId);
		if (pendingResponse) {
			if (message.error) {
				pendingResponse.reject(new Error(message.error));
				pendingResponses.delete(message.requestId);
			} else {
				if (message.truncated) {
					if (pendingResponse.array) {
						pendingResponse.array = pendingResponse.array.concat(message.array);
					} else {
						pendingResponse.array = message.array;
						pendingResponses.set(message.requestId, pendingResponse);
					}
					if (message.finished) {
						message.array = pendingResponse.array;
					}
				}
				if (!message.truncated || message.finished) {
					pendingResponse.resolve({
						status: message.status,
						headers: { get: headerName => message.headers && message.headers[headerName] },
						arrayBuffer: async () => new Uint8Array(message.array).buffer
					});
					pendingResponses.delete(message.requestId);
				}
			}
		}
		return {};
	}

	async function hostFetch(url, options) {
		if (hostFetchSupported === undefined) {
			hostFetchSupported = false;
			document.addEventListener(FETCH_SUPPORTED_RESPONSE_EVENT, () => hostFetchSupported = true, false);
			document.dispatchEvent(new CustomEvent(FETCH_SUPPORTED_REQUEST_EVENT));
		}
		if (hostFetchSupported) {
			const result = new Promise((resolve, reject) => {
				document.dispatchEvent(new CustomEvent(FETCH_REQUEST_EVENT, { detail: JSON.stringify({ url, options }) }));
				document.addEventListener(FETCH_RESPONSE_EVENT, onResponseFetch, false);

				function onResponseFetch(event) {
					if (event.detail) {
						if (event.detail.url == url) {
							document.removeEventListener(FETCH_RESPONSE_EVENT, onResponseFetch, false);
							if (event.detail.response) {
								resolve({
									status: event.detail.status,
									headers: new Map(event.detail.headers),
									arrayBuffer: async () => event.detail.response
								});
							} else {
								reject(event.detail.error);
							}
						}
					} else {
						reject();
					}
				}
			});
			return result;
		} else {
			throw new Error(ERR_HOST_FETCH);
		}
	}

	async function fetchResource(url, options = {}, useHostFetch = true) {
		try {
			const fetchOptions = {
				cache: options.cache || "force-cache",
				headers: options.headers,
				referrerPolicy: options.referrerPolicy || "strict-origin-when-cross-origin"
			};
			let response;
			try {
				if ((options.referrer && !USE_HOST_FETCH) || !useHostFetch) {
					response = await fetch$1(url, fetchOptions);
				} else {
					response = await hostFetch(url, fetchOptions);
				}
				if (response.status == 401 || response.status == 403 || response.status == 404) {
					if (fetchOptions.referrerPolicy != "no-referrer" && !options.referrer) {
						response = await fetchResource(url, { ...fetchOptions, referrerPolicy: "no-referrer" }, useHostFetch);
					}
				}
			} catch (error) {
				if (error && error.message == ERR_HOST_FETCH) {
					response = await fetchResource(url, { ...fetchOptions }, false);
				} else if (fetchOptions.referrerPolicy != "no-referrer" && !options.referrer) {
					response = await fetchResource(url, { ...fetchOptions, referrerPolicy: "no-referrer" }, useHostFetch);
				} else {
					throw error;
				}
			}
			return response;
			// eslint-disable-next-line no-unused-vars
		} catch (error) {
			requestId++;
			const promise = new Promise((resolve, reject) => pendingResponses.set(requestId, { resolve, reject }));
			await sendMessage({ method: "singlefile.fetch", url, requestId, referrer: options.referrer, headers: options.headers });
			return promise;
		}
	}

	async function frameFetch(url, options) {
		const response = await sendMessage({ method: "singlefile.fetchFrame", url, frameId: options.frameId, referrer: options.referrer, headers: options.headers });
		return {
			status: response.status,
			headers: new Map(response.headers),
			arrayBuffer: async () => new Uint8Array(response.array).buffer
		};
	}

	async function sendMessage(message) {
		const response = await browser.runtime.sendMessage(message);
		if (!response || response.error) {
			throw new Error(response && response.error && response.error.toString());
		} else {
			return response;
		}
	}

	/*
	 * Copyright 2010-2020 Gildas Lormeau
	 * contact : gildas.lormeau <at> gmail.com
	 * 
	 * This file is part of SingleFile.
	 *
	 *   The code in this file is free software: you can redistribute it and/or 
	 *   modify it under the terms of the GNU Affero General Public License 
	 *   (GNU AGPL) as published by the Free Software Foundation, either version 3
	 *   of the License, or (at your option) any later version.
	 * 
	 *   The code in this file is distributed in the hope that it will be useful, 
	 *   but WITHOUT ANY WARRANTY; without even the implied warranty of 
	 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero 
	 *   General Public License for more details.
	 *
	 *   As additional permission under GNU AGPL version 3 section 7, you may 
	 *   distribute UNMODIFIED VERSIONS OF THIS file without the copy of the GNU 
	 *   AGPL normally required by section 4, provided you include this license 
	 *   notice and a URL through which recipients can access the Corresponding 
	 *   Source.
	 */


	function injectScript(tabId, options) {
		return inject(tabId, options);
	}

	function getPageData(options, initOptions = { fetch: fetchResource, frameFetch }, doc, win) {
		return globalThis.singlefile.getPageData(options, initOptions, doc, win);
	}

	exports.getPageData = getPageData;
	exports.injectScript = injectScript;

}));
