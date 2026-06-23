using System;
using System.Threading.Tasks;

namespace TaskHub.Agent
{
    public interface ISocketClient
    {
        event Action OnConnected;
        event Action OnDisconnected;
        void On(string eventName, Action<ISocketResponse> callback);
        Task EmitAsync(string eventName, object? data = null);
        Task ConnectAsync();
    }

    public interface ISocketResponse
    {
        T GetValue<T>(int index);
    }
}
