using Xunit;
using FluentAssertions;
using TaskHub.Agent;

namespace TaskHub.Agent.Tests
{
    // The agent's own folder guard. This DUPLICATES the backend's
    // utils/windowsTaskFolder.ts on purpose: this process runs elevated and is
    // the one calling RegisterTaskDefinition, which silently OVERWRITES a
    // same-named task in the same folder. A backend bug — or a signed command
    // built from one — must still be refused here.
    //
    // Mirrors backend/src/utils/__tests__/windowsTaskFolder.test.ts; if the two
    // diverge, the agent and backend disagree about what is safe to write.
    public class TaskFolderPathTests
    {
        [Fact]
        public void Validate_AcceptsTheDefaultAndOrdinaryFolders()
        {
            TaskFolderPath.Validate(TaskFolderPath.Default).Should().BeNull();
            TaskFolderPath.Validate("\\Work").Should().BeNull();
            TaskFolderPath.Validate("\\Work\\Backups").Should().BeNull();
        }

        [Fact]
        public void Validate_AcceptsTheRootFolder()
        {
            // Third-party tasks legitimately live at the root.
            TaskFolderPath.Validate("\\").Should().BeNull();
        }

        [Fact]
        public void Validate_AcceptsForwardSlashes()
        {
            TaskFolderPath.Validate("/Work/Backups").Should().BeNull();
        }

        [Theory]
        [InlineData("\\Microsoft")]
        [InlineData("\\Microsoft\\Windows")]
        [InlineData("\\Microsoft\\Windows\\SystemRestore")]
        [InlineData("\\microsoft")]
        [InlineData("\\MICROSOFT\\Windows")]
        [InlineData("\\MiCrOsOfT\\windows")]
        [InlineData("/Microsoft/Windows")]
        public void Validate_RefusesMicrosoftAtAnyCase(string folder)
        {
            // Windows' own scheduled tasks live here. A name collision would
            // silently overwrite one, from an elevated process.
            TaskFolderPath.Validate(folder).Should().NotBeNull();
        }

        [Fact]
        public void Validate_AllowsFoldersThatMerelyStartWithMicrosoft()
        {
            // Segment equality, not prefix — \MicrosoftEdgeBackups is not \Microsoft.
            TaskFolderPath.Validate("\\MicrosoftEdgeBackups").Should().BeNull();
        }

        [Fact]
        public void Validate_AllowsMicrosoftAsANonRootSegment()
        {
            // \Work\Microsoft is the user's own folder; only the reserved root matters.
            TaskFolderPath.Validate("\\Work\\Microsoft").Should().BeNull();
        }

        [Theory]
        [InlineData("\\Work\\..\\Microsoft")]
        [InlineData("\\TaskHub\\..\\Microsoft\\Windows")]
        [InlineData("\\..")]
        [InlineData("\\Work\\.\\Backups")]
        public void Validate_RefusesTraversal(string folder)
        {
            TaskFolderPath.Validate(folder).Should().NotBeNull();
        }

        [Theory]
        [InlineData("\\Wo:rk")]
        [InlineData("\\Wo*rk")]
        [InlineData("\\Wo?rk")]
        [InlineData("\\Wo\"rk")]
        [InlineData("\\Wo<rk")]
        [InlineData("\\Wo>rk")]
        [InlineData("\\Wo|rk")]
        public void Validate_RefusesInvalidCharacters(string folder)
        {
            TaskFolderPath.Validate(folder).Should().NotBeNull();
        }

        [Fact]
        public void Validate_RefusesControlCharacters()
        {
            TaskFolderPath.Validate("\\Wo\u0001rk").Should().NotBeNull();
        }

        [Theory]
        [InlineData("\\Work.")]
        [InlineData("\\Work ")]
        public void Validate_RefusesTrailingDotsAndSpaces(string folder)
        {
            // Windows silently strips these on disk, so "Work." collides with "Work".
            TaskFolderPath.Validate(folder).Should().NotBeNull();
        }

        [Theory]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData(null)]
        public void Validate_RefusesEmptyInput(string? folder)
        {
            TaskFolderPath.Validate(folder).Should().NotBeNull();
        }

        [Fact]
        public void Validate_RefusesAnOverDeepPath()
        {
            TaskFolderPath.Validate("\\a\\b\\c\\d\\e\\f\\g\\h\\i").Should().NotBeNull();
        }

        [Fact]
        public void Normalize_CanonicalizesSeparatorsAndTrailingSlashes()
        {
            TaskFolderPath.Normalize("\\Work\\").Should().Be("\\Work");
            TaskFolderPath.Normalize("/Work/Backups").Should().Be("\\Work\\Backups");
            TaskFolderPath.Normalize("Work").Should().Be("\\Work");
            TaskFolderPath.Normalize("\\\\Work\\\\Backups").Should().Be("\\Work\\Backups");
        }

        [Fact]
        public void Normalize_MapsTheRootToASingleBackslash()
        {
            TaskFolderPath.Normalize("\\").Should().Be("\\");
            TaskFolderPath.Normalize("").Should().Be("\\");
        }

        [Theory]
        [InlineData("\\TaskHub")]
        [InlineData("\\taskhub")]
        [InlineData("\\TASKHUB")]
        [InlineData("TaskHub")]
        [InlineData("/TaskHub")]
        [InlineData("\\TaskHub\\")]
        public void IsDefault_RecognizesOurOwnFolderInAnyWrittenForm(string folder)
        {
            // \TaskHub is the ONLY folder the agent creates, because it is the only
            // one it prunes. Missing a spelling here would make CreateTask refuse to
            // create our own default folder on a fresh install.
            TaskFolderPath.IsDefault(folder).Should().BeTrue();
        }

        [Theory]
        [InlineData("\\Work")]
        [InlineData("\\TaskHub\\Nested")]
        [InlineData("\\TaskHubExtra")]
        [InlineData("\\Task-Hub")]
        [InlineData("\\")]
        public void IsDefault_RejectsEverythingElse(string folder)
        {
            // These must NOT be auto-created: deleting a folder needs elevation, so
            // anything TaskHub creates beyond its own is litter only the user can
            // clear. Note \Task-Hub (the hyphenated self-heal infra folder) and
            // \TaskHub\Nested are both distinct from \TaskHub.
            TaskFolderPath.IsDefault(folder).Should().BeFalse();
        }

        [Fact]
        public void Normalize_MatchesTheBackendForTheDefaultFolder()
        {
            // The signed message carries this exact string; if the two sides
            // normalize differently the HMAC will not verify and every create
            // fails. Pinned to the literal the backend sends.
            TaskFolderPath.Normalize(TaskFolderPath.Default).Should().Be("\\TaskHub");
        }
    }
}
