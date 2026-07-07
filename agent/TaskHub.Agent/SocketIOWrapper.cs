using System;
using System.Threading.Tasks;
using SocketIOClient;

namespace TaskHub.Agent
{
    public class SocketIOWrapper : ISocketClient
    {
        private readonly SocketIO _client;

        public event Action? OnConnected;
        public event Action? OnDisconnected;

        public SocketIOWrapper(string serverUrl)
        {
            // ReconnectionAttempts defaults to 10, so the client gives up after a
            // longer server outage — the Program watchdog re-calls ConnectAsync to
            // cover that. Don't raise the attempts to int.MaxValue: the library's
            // internal delay math overflows and every connect throws.
            _client = new SocketIO(new Uri(serverUrl));

            _client.OnConnected += (sender, e) => OnConnected?.Invoke();
            _client.OnDisconnected += (sender, e) => OnDisconnected?.Invoke();
        }

        public bool Connected => _client.Connected;

        public void On(string eventName, Action<ISocketResponse> callback)
        {
            _client.On(eventName, response =>
            {
                callback(new SocketIOResponseWrapper(response));
                return Task.CompletedTask;
            });
        }

        public Task EmitAsync(string eventName, object? data = null)
        {
            if (data == null)
            {
                return _client.EmitAsync(eventName);
            }
            if (data is System.Collections.Generic.IEnumerable<object> enumerable)
            {
                return _client.EmitAsync(eventName, enumerable);
            }
            if (data is System.Collections.IEnumerable rawEnumerable)
            {
                var list = new System.Collections.Generic.List<object>();
                foreach (var item in rawEnumerable)
                {
                    list.Add(item);
                }
                return _client.EmitAsync(eventName, list);
            }
            return _client.EmitAsync(eventName, new[] { data });
        }

        public Task ConnectAsync()
        {
            return _client.ConnectAsync();
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
