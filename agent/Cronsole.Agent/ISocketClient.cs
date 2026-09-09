using System;
using System.Threading.Tasks;

namespace Cronsole.Agent
{
    public interface ISocketClient
    {
        event Action OnConnected;
        event Action OnDisconnected;
        bool Connected { get; }
        void On(string eventName, Action<ISocketResponse> callback);
        Task EmitAsync(string eventName, object? data = null);
        Task ConnectAsync();
    }

    public interface ISocketResponse
    {
        T GetValue<T>(int index);
    }
}
