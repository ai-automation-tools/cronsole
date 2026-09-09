using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using SocketIOClient;

namespace Cronsole.Agent
{
    // Reconnect strategy (see the Program watchdog):
    //
    // The underlying WebSocket transitions to an 'Aborted' state after any
    // disconnect and CANNOT be reused — calling ConnectAsync() again on the same
    // SocketIO instance throws (doghappy/socket.io-client-csharp#215). On top of
    // that, a server-initiated disconnect (a backend restart => IOServerDisconnect)
    // does not trigger the library's own auto-reconnect at all, and calling
    // ConnectAsync() while the library IS mid auto-reconnect can open duplicate
    // sockets.
    //
    // So we make the watchdog the single reconnect authority: internal reconnection
    // is disabled, and every ConnectAsync() disposes the old (possibly aborted)
    // client and builds a fresh one with all handlers reattached. Deterministic, no
    // duplicate sockets, no aborted-state reuse.
    public class SocketIOWrapper : ISocketClient, IDisposable
    {
        private readonly string _serverUrl;
        private readonly AgentAuthenticator _auth;
        private readonly object _lock = new();
        private readonly List<(string EventName, Action<ISocketResponse> Callback)> _handlers = new();
        private SocketIO? _client;

        public event Action? OnConnected;
        public event Action? OnDisconnected;

        public SocketIOWrapper(string serverUrl, AgentAuthenticator auth)
        {
            _serverUrl = serverUrl;
            _auth = auth ?? throw new ArgumentNullException(nameof(auth));
        }

        // Null until the first ConnectAsync(): callers register handlers (via On) at
        // construction time, before any connection exists.
        public bool Connected => _client?.Connected ?? false;

        public void On(string eventName, Action<ISocketResponse> callback)
        {
            lock (_lock)
            {
                // Remembered so they can be reattached to each fresh client we build.
                _handlers.Add((eventName, callback));
                if (_client != null)
                {
                    RegisterHandler(_client, eventName, callback);
                }
            }
        }

        public Task EmitAsync(string eventName, object? data = null)
        {
            var client = _client;
            // Emits only originate from event handlers that fire while connected, but
            // guard the race where a disconnect lands between the two.
            if (client == null)
            {
                return Task.CompletedTask;
            }
            if (data == null)
            {
                return client.EmitAsync(eventName);
            }
            if (data is IEnumerable<object> enumerable)
            {
                return client.EmitAsync(eventName, enumerable);
            }
            if (data is System.Collections.IEnumerable rawEnumerable)
            {
                var list = new List<object>();
                foreach (var item in rawEnumerable)
                {
                    list.Add(item);
                }
                return client.EmitAsync(eventName, list);
            }
            return client.EmitAsync(eventName, new[] { data });
        }

        public async Task ConnectAsync()
        {
            SocketIO client;
            lock (_lock)
            {
                if (_client != null && _client.Connected)
                {
                    return;
                }

                // Dispose the old (aborted) client and start clean.
                _client?.Dispose();
                _client = BuildClient();
                client = _client;
            }

            await client.ConnectAsync();
        }

        // Caller holds _lock.
        private SocketIO BuildClient()
        {
            // Reconnection disabled: the watchdog owns reconnection so it never races
            // the library's internal loop (which would open duplicate sockets).
            //
            // Auth carries the pairing-secret handshake (agentId, nonce, ts, hmac).
            // A fresh nonce per connect => a fresh per-session key, so a reconnect
            // rekeys the command channel. Serialized into socket.handshake.auth
            // server-side, where agentAuthMiddleware verifies it.
            var client = new SocketIO(new Uri(_serverUrl), new SocketIOOptions
            {
                Reconnection = false,
                Auth = _auth.CreateHandshakeAuth()
            });

            client.OnConnected += (_, _) => OnConnected?.Invoke();
            client.OnDisconnected += (_, _) => OnDisconnected?.Invoke();

            foreach (var (eventName, callback) in _handlers)
            {
                RegisterHandler(client, eventName, callback);
            }

            return client;
        }

        private static void RegisterHandler(SocketIO client, string eventName, Action<ISocketResponse> callback)
        {
            client.On(eventName, response =>
            {
                callback(new SocketIOResponseWrapper(response));
                return Task.CompletedTask;
            });
        }

        public void Dispose()
        {
            lock (_lock)
            {
                _client?.Dispose();
                _client = null;
            }
        }
    }

    public class SocketIOResponseWrapper : ISocketResponse
    {
        private readonly SocketIOClient.IEventContext _response;

        public SocketIOResponseWrapper(SocketIOClient.IEventContext response)
        {
            _response = response;
        }

        public T GetValue<T>(int index)
        {
            return _response.GetValue<T>(index)!;
        }
    }
}
