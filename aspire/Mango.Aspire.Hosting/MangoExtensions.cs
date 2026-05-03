using System.Globalization;
using Aspire.Hosting.ApplicationModel;
using Microsoft.Extensions.Configuration;

namespace Aspire.Hosting;

/// <summary>
/// Aspire integration for the Mango MongoDB workbench. Adds a container
/// resource running the published Mango image and points it at a MongoDB
/// resource. Drop-in replacement for <c>WithMongoExpress()</c>.
/// </summary>
public static class MangoExtensions
{
    private const string DefaultName = "mango";
    private const int DefaultPort = 5180;
    private const int ContainerTargetPort = 5180;
    private const string DefaultImage = "ghcr.io/philbir/mango";
    private const string DefaultTag = "latest";

    /// <summary>
    /// Attaches the Mango UI to a MongoDB server resource using the published
    /// container image (defaults to <c>ghcr.io/philbir/mango:latest</c>).
    /// </summary>
    /// <param name="builder">The MongoDB server resource builder.</param>
    /// <param name="databaseName">
    /// Default database. When provided, Mango opens this database first.
    /// </param>
    /// <param name="port">Host port for the Mango UI.</param>
    /// <param name="name">Aspire resource name shown in the dashboard.</param>
    /// <param name="image">Container image — override to pin a specific build or use a private registry.</param>
    /// <param name="tag">Container image tag — defaults to <c>latest</c>.</param>
    /// <param name="standalone">
    /// When true (default), Mango runs in standalone mode: the connection from
    /// the wired-up Mongo container is the only connection and the connection
    /// manager UI is hidden. Pass <c>false</c> to expose the full multi-connection UI.
    /// </param>
    public static IResourceBuilder<MongoDBServerResource> WithMango(
        this IResourceBuilder<MongoDBServerResource> builder,
        string? databaseName = null,
        int port = DefaultPort,
        string name = DefaultName,
        string image = DefaultImage,
        string tag = DefaultTag,
        bool standalone = true)
    {
        var mango = builder.ApplicationBuilder
            .AddContainer(name, image, tag)
            .WaitFor(builder)
            // Nest under the Mongo resource in the Aspire dashboard, mirroring
            // the layout of WithMongoExpress.
            .WithParentRelationship(builder.Resource)
            .WithHttpEndpoint(port: port, targetPort: ContainerTargetPort, name: "http")
            .WithExternalHttpEndpoints()
            // The Mongo resource's ConnectionStringExpression resolves the host
            // through .NET service discovery (e.g. mongo.dev.internal), which a
            // non-.NET container can't resolve. Build the URL using the Mongo
            // container's network alias instead — same trick WithMongoExpress uses.
            .WithEnvironment(ctx => ctx.EnvironmentVariables["MONGO_URL"] = BuildContainerMongoUrl(builder.Resource))
            // Persist JSON state (saved settings + multi-mode connection list) across restarts.
            .WithVolume($"{name}-data", "/data")
            .WithEnvironment("MANGO_DATA_DIR", "/data");

        if (standalone)
        {
            mango.WithEnvironment("MANGO_MODE", "standalone");
        }

        if (!string.IsNullOrWhiteSpace(databaseName))
        {
            mango.WithEnvironment("MONGO_DB", databaseName);
        }

        // Optional AI configuration. Set via user-secrets / appsettings.json:
        //   Mango:Ai:Provider     — "openai" (default) or "copilot"
        //   openai:
        //     Mango:Ai:ApiKey      — OpenAI / GitHub Models / Azure key
        //     Mango:Ai:BaseUrl     — e.g. https://models.github.ai/inference
        //     Mango:Ai:Model       — e.g. gpt-4o-mini, openai/gpt-4o-mini
        //   copilot (uses @github/copilot-sdk):
        //     Mango:Ai:GitHubToken — token with Copilot access
        //     Mango:Ai:Model       — e.g. gpt-5, claude-sonnet-4.5
        ApplyAiSettings(mango, builder.ApplicationBuilder.Configuration);

        // Master key for encrypting saved connection URIs at rest. Auto-generated
        // by the server on first run if not supplied — set explicitly to share an
        // encrypted state across machines or to rotate the key.
        var masterKey = builder.ApplicationBuilder.Configuration["Mango:MasterKey"];
        if (!string.IsNullOrWhiteSpace(masterKey))
        {
            mango.WithEnvironment("MANGO_MASTER_KEY", masterKey);
        }

        return builder;
    }

    private static ReferenceExpression BuildContainerMongoUrl(MongoDBServerResource server)
    {
        var port = (server.PrimaryEndpoint.TargetPort ?? 27017)
            .ToString(CultureInfo.InvariantCulture);

        if (server.PasswordParameter is not null)
        {
            return ReferenceExpression.Create(
                $"mongodb://{server.UserNameReference}:{server.PasswordParameter}@{server.Name}:{port}/?authSource=admin&authMechanism=SCRAM-SHA-256");
        }

        return ReferenceExpression.Create($"mongodb://{server.Name}:{port}");
    }

    private static void ApplyAiSettings(
        IResourceBuilder<ContainerResource> resource,
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
