if (!WebAssembly.instantiateStreaming) { // polyfill
    WebAssembly.instantiateStreaming = async (resp, importObject) => {
        const source = await (await resp).arrayBuffer();
        return await WebAssembly.instantiate(source, importObject);
    };
}

const go = new Go();
let namespace = ""

async function startInstance(module, instance) {
    namespace = $('#namespace').val();

    if (localStorage.getItem(namespace+":mailboxHost")) {
        server = localStorage.getItem(namespace+":mailboxHost")
        document.getElementById('server').value = server
    }
    if (localStorage.getItem(namespace + ":expiry")) {
        let expiry = new Date(localStorage.getItem(namespace + ":expiry") * 1000);
        if (expiry < Date.now()) {
            document.getElementById('expiry').innerHTML = "Session has expired";
            return
        }
    }

    // Set the callbacks on the namespace object
    window[namespace] = {
        onAuthData: onAuthData,
        onLocalKeyCreate: onLocalKeyCreate,
        onRemoteKeyReceive: onRemoteKeyReceive,
    };

    console.clear();
    go.argv = [
        'wasm-client',
        '--debuglevel=trace',
        '--namespace=' + namespace,
        '--onlocalprivcreate=' + namespace + '.onLocalKeyCreate',
        '--onremotekeyreceive=' + namespace + '.onRemoteKeyReceive',
        '--onauthdata=' + namespace + '.onAuthData',
    ];
    let readyTicker = null;
    let isReady = function () {
        if (!window[namespace]) {
            return
        }
        let result = window[namespace].wasmClientIsReady();
        console.log('Is WASM client ready? Result: ' + result);
        if (result === true) {
            clearInterval(readyTicker);
            document.getElementById('runButton').disabled = false;
        }

        // If we have a remote key stored, it means that the handshake we will do to create a connection will not
        // involve the passphrase, so we can immediately connect to the server.
        if (localStorage.getItem(namespace+":remoteKey")) {
            connectServer()
        } else {
            $('#passphrase').show();
        }
    }
    readyTicker = setInterval(isReady, 200);

    let connStatus = function () {
        let result = window[namespace].wasmClientStatus();
        document.getElementById('status').innerHTML = "Connection Status: " + result;
    }
    setInterval(connStatus, 200);

    await go.run(instance);
    await WebAssembly.instantiate(module, go.importObject);
}

async function initClient() {
    WebAssembly.instantiateStreaming(fetch('wasm-client.wasm'), go.importObject).then((result) => {
        startInstance(result.module, result.instance);
    }).catch((err) => {
        console.error(err);
    });
}

async function disconnect() {
    window[namespace].wasmClientDisconnect();

    document.getElementById('disconnectBtn').disabled = true;
    document.getElementById('reconnectBtn').disabled = false;
    document.getElementById('ready').style.display= 'none' ;
}

async function connectServer() {
    let server = $('#server').val();
    localStorage.setItem(namespace+":mailboxHost", server)

    let localKey = ""
    let remoteKey = ""

    if (localStorage.getItem(namespace+":localKey")) {
        localKey = localStorage.getItem(namespace+":localKey")
    }

    if (localStorage.getItem(namespace+":remoteKey")) {
        remoteKey = localStorage.getItem(namespace+":remoteKey")
    }

    let passphrase = $('#phrase').val();
    let connectedTicker = null;
    let isConnected = function () {
        let result = window[namespace].wasmClientIsConnected();
        console.log('Is WASM client connected? Result: ' + result);
        if (result === true) {
            clearInterval(connectedTicker);
            $('#ready').show();
            document.getElementById('runButton').disabled = true;
            window.onunload = window[namespace].wasmClientDisconnect;
        }
    }
    connectedTicker = setInterval(isConnected, 200);
    window[namespace].wasmClientConnectServer(server, true, passphrase, localKey, remoteKey);

    document.getElementById('disconnectBtn').disabled = false;
    document.getElementById('reconnectBtn').disabled = true;
}

async function clearStorage() {
    localStorage.clear()
}

async function callWASM(rpcName, req) {
    window[namespace].wasmClientInvokeRPC('lnrpc.Lightning.' + rpcName, req, setResult);
}

async function callWASMLoop(rpcName, req) {
    window[namespace].wasmClientInvokeRPC('looprpc.SwapClient.' + rpcName, req, setResult);
}

async function callWASMPool(rpcName, req) {
    window[namespace].wasmClientInvokeRPC('poolrpc.Trader.' + rpcName, req, setResult);
}

async function callWASMFaraday(rpcName, req) {
    window[namespace].wasmClientInvokeRPC('frdrpc.FaradayServer.' + rpcName, req, setResult);
}

async function callWASMDirect(rpcName, req) {
    window[namespace].wasmClientInvokeRPC(rpcName, req, setResult);
}

async function callWASMAutopilot(rpcName, req) {
    window[namespace].wasmClientInvokeRPC('litrpc.Autopilot.' + rpcName, req, setResult);
}

async function callWASMLit(rpcName, req) {
    window[namespace].wasmClientInvokeRPC('litrpc.Lit.' + rpcName, req, setResult);
}

function setResult(result) {
    $('#output').text(result);
}

function onLocalKeyCreate(keyHex) {
    console.log("local private key created: "+keyHex)
    localStorage.setItem(namespace+":localKey", keyHex)
    return {}
    // In case of an error, return an object with the following structure:
    //      `return {err:"this totally failed"}`
}

function onRemoteKeyReceive(keyHex) {
    console.log("remote key received: "+keyHex)
    localStorage.setItem(namespace+":remoteKey", keyHex)
    return {}
    // In case of an error, return an object with the following structure:
    //      `return {err:"this totally failed"}`
}

function onAuthData(data) {
    console.log("auth data received: "+data)

    // extract expiry.
    let expiry = window[namespace].wasmClientGetExpiry();
    if (!expiry) {
        document.getElementById('expiry').innerHTML = "No expiry found in macaroon";
    } else {
        localStorage.setItem(namespace+":expiry", expiry)
        document.getElementById('expiry').innerHTML = "Session Expiry: "+new Date(expiry*1000).toLocaleString();
    }

    // Determine if the session is a read only session.
    let readOnlySession = window[namespace].wasmClientIsReadOnly();
    let customSession = window[namespace].wasmClientIsCustom();
    if (customSession) {
        document.getElementById('sessiontype').textContent = "This is a Custom Session"
    } else if (readOnlySession) {
        document.getElementById('sessiontype').textContent = "This is a Read-Only Session"
    } else {
        document.getElementById('sessiontype').textContent = "This is an Admin Session"
    }

    // extract permissions.
    if (window[namespace].wasmClientHasPerms("lnrpc.Lightning.GetInfo")) {
        document.getElementById('getinfo').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("lnrpc.Lightning.ListChannels")) {
        document.getElementById('listchannels').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("lnrpc.Lightning.ListPeers")) {
        document.getElementById('listpeers').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("lnrpc.Lightning.WalletBalance")) {
        document.getElementById('walletbalance').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("lnrpc.Lightning.NewAddress")) {
        document.getElementById('newaddr1').disabled = false;
        document.getElementById('newaddr2').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("lnrpc.Lightning.SubscribeTransactions")) {
        document.getElementById('subscribetx').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("autopilotrpc.Autopilot.Status")) {
        document.getElementById('autopilotrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("chainrpc.ChainNotifier.RegisterBlockEpochNtfn")) {
        document.getElementById('chainrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("invoicesrpc.Invoices.AddHoldInvoice")) {
        document.getElementById('invoicesrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("routerrpc.Router.GetMissionControlConfig")) {
        document.getElementById('routerrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("signrpc.Signer.SignMessage")) {
        document.getElementById('signrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("lnrpc.State.GetState")) {
        document.getElementById('lnrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("walletrpc.WalletKit.ListUnspent")) {
        document.getElementById('walletrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("watchtowerrpc.Watchtower.GetInfo")) {
        document.getElementById('watchtowerrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("wtclientrpc.WatchtowerClient.ListTowers")) {
        document.getElementById('wtclientrpc').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("looprpc.SwapClient.LoopOutTerms")) {
        document.getElementById('loopoutterms').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("poolrpc.Trader.GetInfo")) {
        document.getElementById('poolinfo').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("frdrpc.FaradayServer.RevenueReport")) {
        document.getElementById('revenuereport').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("litrpc.Autopilot.ListAutopilotFeatures")) {
        document.getElementById('autopilotfeatures').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("litrpc.Firewall.ListActions")) {
        document.getElementById('litactions').disabled = false;
    }
    if (window[namespace].wasmClientHasPerms("litrpc.Autopilot.ListAutopilotSessions")) {
        document.getElementById('autopilotsessions').disabled = false;
    }

    return {}
    // In case of an error, return an object with the following structure:
    //      `return {err:"this totally failed"}`
}