window.postMessage({
    type: 'FROM_PAGE',
    au_token: window.config.au_token
}, '*');