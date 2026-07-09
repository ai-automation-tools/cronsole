using FluentAssertions;
using TaskHub.Agent;
using Xunit;

namespace TaskHub.Agent.Tests
{
    public class ArgumentQuotingTests
    {
        [Fact]
        public void SimpleArgs_PassThroughUnquoted()
        {
            ArgumentQuoting.Join(new[] { "-NoProfile", "-File" })
                .Should().Be("-NoProfile -File");
        }

        [Fact]
        public void ArgWithSpace_IsQuoted()
        {
            ArgumentQuoting.Join(new[] { "C:\\my scripts\\backup.ps1" })
                .Should().Be("\"C:\\my scripts\\backup.ps1\"");
        }

        [Fact]
        public void ArgWithEmbeddedQuote_EscapesTheQuote()
        {
            // value: a"b  ->  "a\"b"
            ArgumentQuoting.Join(new[] { "a\"b" })
                .Should().Be("\"a\\\"b\"");
        }

        [Fact]
        public void TrailingBackslashesBeforeClosingQuote_AreDoubled()
        {
            // value: C:\path\  (has a space so it quotes) -> "C:\path with space\\"
            ArgumentQuoting.Join(new[] { "C:\\path dir\\" })
                .Should().Be("\"C:\\path dir\\\\\"");
        }

        [Fact]
        public void EmptyArg_BecomesEmptyQuotes()
        {
            ArgumentQuoting.Join(new[] { "" }).Should().Be("\"\"");
        }

        [Fact]
        public void InjectionMetacharacters_StayInsideOneQuotedArgument()
        {
            // The whole malicious value is one argument to the target program; there
            // is no shell to interpret & | ; so no second process can be launched.
            ArgumentQuoting.Join(new[] { "foo & calc.exe" })
                .Should().Be("\"foo & calc.exe\"");
        }

        [Fact]
        public void MultipleArgs_JoinedWithSingleSpaces()
        {
            ArgumentQuoting.Join(new[] { "-File", "C:\\a b.ps1", "-Verbose" })
                .Should().Be("-File \"C:\\a b.ps1\" -Verbose");
        }
    }
}
