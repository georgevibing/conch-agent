---
provider: azure-openai
---

## Connect it

1. Open **Settings → Providers** and find **Azure OpenAI**.
2. Press **Sign in to Azure** and enter the short code on Microsoft's page, from any device.
3. Press **Use this** on one of your Azure OpenAI or Azure AI Foundry resources. Its chat deployments join the model picker.

No Azure CLI here? Press **Install Azure CLI** when Conch offers it.

## Good to know

- **Your deployments are the models**, each under its own name. Embedding and speech deployments are left out.
- **You need the Azure OpenAI User role** (or Azure AI User) on the resource.
- **Read-only.** Conch never changes anything in Azure. Tokens come from the Azure CLI, stay in memory and go only to Microsoft.
- **No price shown.** A deployment's name doesn't say what it costs. Azure's billing shows it.
- **Resource keys aren't taken yet.** Sign in with your Azure account instead.
