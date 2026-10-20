const { PluginPackageService } = require('../../dist/integrations/plugin-package.service');
const { McpToolsService } = require('../../dist/integrations/mcp-tools.service');
const { McpDataService } = require('../../dist/integrations/mcp-data.service');
const { ExternalContractService } = require('../../dist/external-api/external-contract.service');
// Metadata generation uses real protocol definitions but never submits data queries.
function createPluginTools() { return new McpToolsService(null, new McpDataService(null, new ExternalContractService(), null, null), null); }
function createPluginPackageService(settings) { return new PluginPackageService(settings, createPluginTools()); }
module.exports = { createPluginTools, createPluginPackageService };
