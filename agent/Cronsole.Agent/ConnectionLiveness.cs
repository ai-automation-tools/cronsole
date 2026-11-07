using System;

namespace Cronsole.Agent
{
    // Decides whether a socket the library CLAIMS is connected is actually alive.
    //
    // SocketIOClient 4.0.5 can leave Connected == true on a dead connection:
    //  - WebSocketAdapter.ReceiveAsync returns on a WebSocket Close frame without
    //    raising OnDisconnected, so a graceful backend shutdown (restart, tsx watch
    //    reload) is never noticed;
    //  - it has no client-side ping timeout for Engine.IO v4, so a server that goes
    //    silent without closing the socket is never noticed either.
    // Either way the watchdog saw Connected == true and never reconnected.
    //
    // The server pings every pingInterval (Socket.IO default 25s) and drops a client
    // after pingTimeout (default 20s), so silence longer than ~45s means the
    // connection is gone. The default window leaves slack over that.
    public sealed class ConnectionLiveness
    {
        public static readonly TimeSpan DefaultWindow = TimeSpan.FromSeconds(60);

        private readonly TimeSpan _window;
        private readonly Func<long> _nowMs;
        private long _lastSeenMs;

        public ConnectionLiveness(TimeSpan? window = null, Func<long>? nowMs = null)
        {
            _window = window ?? DefaultWindow;
            _nowMs = nowMs ?? (() => Environment.TickCount64);
            _lastSeenMs = _nowMs();
        }

        // Call on connect and on every server ping.
        public void Touch() => System.Threading.Interlocked.Exchange(ref _lastSeenMs, _nowMs());

        public bool IsStale =>
            _nowMs() - System.Threading.Interlocked.Read(ref _lastSeenMs) > (long)_window.TotalMilliseconds;
    }
}
