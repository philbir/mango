# Mango.Aspire.Hosting

Aspire integration for [Mango](https://github.com/philbir/mango) — a friendly MongoDB workbench. Adds the Mango UI alongside your MongoDB resource.

```bash
dotnet add package Mango.Aspire.Hosting
```

## Usage

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var mongo = builder.AddMongoDB("mongo")
    .WithLifetime(ContainerLifetime.Persistent);

mongo.WithMango();   // ← drops in the Mango UI

builder.Build().Run();
```

`WithMango()` runs the published container image (`ghcr.io/philbir/mango:latest`) on port 5180 and wires `MONGO_URL` from the Mongo resource's connection string. Defaults to **standalone mode** (single connection, connection-manager UI hidden) since Aspire always provides the Mongo container — pass `standalone: false` for the full multi-connection workbench.

### Options

| Parameter | Default | |
|---|---|---|
| `databaseName` | (URI path) | Default database to open. |
| `port` | `5180` | Host port for the UI. |
| `name` | `"mango"` | Aspire resource name. |
| `image` | `"ghcr.io/philbir/mango"` | Override to pin a build or use a private registry. |
| `tag` | `"latest"` | Image tag. |
| `standalone` | `true` | Set `false` to expose the multi-connection manager. |

### Configuration via user-secrets

```bash
dotnet user-secrets set "Mango:Ai:Provider" "copilot"
dotnet user-secrets set "Mango:Ai:Model"    "claude-sonnet-4.5"
dotnet user-secrets set "Mango:MasterKey"   "$(openssl rand -base64 32)"
```

Forwarded keys: `Mango:Ai:Provider`, `Mango:Ai:ApiKey`, `Mango:Ai:BaseUrl`, `Mango:Ai:Model`, `Mango:Ai:GitHubToken`, `Mango:MasterKey`.

## License

MIT
