---
provider: azure-openai
---

## Connect it

1. Open **Settings → Providers** and find **Azure OpenAI**.
2. Press **Sign in to Azure**. A short code appears: enter it on Microsoft's page, from any device.
3. Conch lists the Azure OpenAI and Azure AI Foundry resources in your subscriptions. Press **Use this** on one. Its chat deployments join the model picker.

No Azure CLI here? Press **Install Azure CLI** when Conch offers it.

## Good to know

- **Your deployments are the models.** Each one you deployed in the Azure AI Foundry portal is a model in the picker, under its own name. Embedding and speech deployments are left out.
- **Your Azure role decides.** You need the Azure OpenAI User role (or Azure AI User) on the resource.
- **Read-only.** Conch reads your subscriptions and resources and never changes anything in Azure. Tokens come from the Azure CLI, stay in memory, and only go to Microsoft's own addresses.
- **No price shown.** A deployment's name doesn't say what it costs, so Conch doesn't guess. Azure's billing shows it.
- **Resource keys aren't taken yet.** Sign in with your Azure account instead.
