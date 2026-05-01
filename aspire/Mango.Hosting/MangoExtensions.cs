using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.JavaScript;
using Microsoft.Extensions.Configuration;

namespace Aspire.Hosting;

/// <summary>
/// Aspire integration for the Mango MongoDB workbench. Adds a Node-app resource
/// that runs the Mango server (Hono + React UI) and points it at a MongoDB resource.
/// Drop-in replacement for <c>WithMongoExpress()</c>.
/// </summary>
public static class MangoExtensions
{
    private const string DefaultName = "mango";
    private const int DefaultPort = 5180;
    private const string DefaultWorkingDirectory = "../../../mango";

    /// <summary>
    /// Attaches the Mango UI to a MongoDB server resource.
    /// </summary>
    /// <param name="builder">The MongoDB server resource builder.</param>
    /// <param name="databaseName">
    /// Default database. When provided, Mango opens this database first.
    /// Mango itself supports multiple connections + databases at runtime — this is just the seed.
    /// </param>
    /// <param name="port">Host port for the Mango UI.</param>
    /// <param name="name">Aspire resource name shown in the dashboard.</param>
    /// <param name="workingDirectory">
    /// Path to the mango package (relative to AppHost). Defaults to a sibling
    /// <c>../../../mango</c> checkout — override when integrating from another repo.
    /// </param>
    public static IResourceBuilder<MongoDBServerResource> WithMango(
        this IResourceBuilder<MongoDBServerResource> builder,
        string? databaseName = null,
        int port = DefaultPort,
        string name = DefaultName,
        string workingDirectory = DefaultWorkingDirectory)
    {
        // Run via `yarn run aspire` — the bundled root script handles
        // `yarn install` + UI build + server dev itself, so we disable
        // Aspire's own pre-install step to avoid duplicating that work.
        var resource = builder.ApplicationBuilder.AddJavaScriptApp(name, workingDirectory, "aspire");
        resource
            .WithYarn(install: false)
            .WithReference(builder)
            .WaitFor(builder)
            .WithHttpEndpoint(port: port, env: "PORT", name: "http")
            .WithExternalHttpEndpoints();

        if (!string.IsNullOrWhiteSpace(databaseName))
        {
            resource.WithEnvironment("MONGO_DB", databaseName);
        }

        // Optional AI configuration. Set via user-secrets / appsettings.json:
        //   Mango:Ai:Provider     — "openai" (default) or "copilot"
        //   openai:
        //     Mango:Ai:ApiKey      — OpenAI / GitHub Models / Azure key
        //     Mango:Ai:BaseUrl     — e.g. https://models.github.ai/inference
        //     Mango:Ai:Model       — e.g. gpt-4o-mini, openai/gpt-4o-mini
        //   copilot (uses @github/copilot-sdk):
        //     Mango:Ai:GitHubToken — token with Copilot access (optional;
        //                            falls back to logged-in Copilot CLI session)
        //     Mango:Ai:Model       — e.g. gpt-5, claude-sonnet-4.5
        ApplyAiSettings(resource, builder.ApplicationBuilder.Configuration);

        // Master key for encrypting saved connection URIs at rest. Auto-generated
        // by the server on first run if not supplied — set explicitly to share an
        // encrypted SQLite across machines or to rotate the key.
        var masterKey = builder.ApplicationBuilder.Configuration["Mango:MasterKey"];
        if (!string.IsNullOrWhiteSpace(masterKey))
        {
            resource.WithEnvironment("MANGO_MASTER_KEY", masterKey);
        }

        // Optional override for where Mango stores its SQLite (default: ./.mango).
        var dataDir = builder.ApplicationBuilder.Configuration["Mango:DataDir"];
        if (!string.IsNullOrWhiteSpace(dataDir))
        {
            resource.WithEnvironment("MANGO_DATA_DIR", dataDir);
        }

        return builder;
    }

    private static void ApplyAiSettings(
        IResourceBuilder<JavaScriptAppResource> resource,
        IConfiguration cfg)
    {
        var aiProvider = cfg["Mango:Ai:Provider"];
        var aiKey = cfg["Mango:Ai:ApiKey"];
        var aiGitHubToken = cfg["Mango:Ai:GitHubToken"];

        var anyAiSetting =
            !string.IsNullOrWhiteSpace(aiProvider)
            || !string.IsNullOrWhiteSpace(aiKey)
            || !string.IsNullOrWhiteSpace(aiGitHubToken);

        if (!anyAiSetting) return;

        if (!string.IsNullOrWhiteSpace(aiProvider))
        {
            resource.WithEnvironment("AI_PROVIDER", aiProvider);
        }
        if (!string.IsNullOrWhiteSpace(aiKey))
        {
            resource.WithEnvironment("AI_API_KEY", aiKey);
        }
        if (!string.IsNullOrWhiteSpace(aiGitHubToken))
        {
            resource.WithEnvironment("GITHUB_TOKEN", aiGitHubToken);
        }
        var aiBaseUrl = cfg["Mango:Ai:BaseUrl"];
        if (!string.IsNullOrWhiteSpace(aiBaseUrl))
        {
            resource.WithEnvironment("AI_BASE_URL", aiBaseUrl);
        }
        var aiModel = cfg["Mango:Ai:Model"];
        if (!string.IsNullOrWhiteSpace(aiModel))
        {
            resource.WithEnvironment("AI_MODEL", aiModel);
        }
    }
}
