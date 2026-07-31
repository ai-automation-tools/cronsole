using Xunit;
using FluentAssertions;
using Cronsole.Agent;

namespace Cronsole.Agent.Tests
{
    public class AgentConfigTests
    {
        [Theory]
        [InlineData("env", "file", "def", "env")]   // env wins
        [InlineData(null, "file", "def", "file")]   // fall back to file
        [InlineData("", "file", "def", "file")]     // blank env is ignored
        [InlineData("  ", "file", "def", "file")]   // whitespace env is ignored
        [InlineData(null, null, "def", "def")]      // fall back to default
        [InlineData(null, "  ", "def", "def")]      // whitespace file is ignored
        public void Pick_ResolvesInPrecedenceOrder(string? env, string? file, string? fallback, string expected)
        {
            AgentConfig.Pick(env, file, fallback).Should().Be(expected);
        }
    }
}
