// Local operator export only: compile Nest DI without init/listen so no jobs run.
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

async function main() {
  const args = process.argv.slice(2);
  let origin, output = path.join(root, 'artifacts/agent-plugins'), development = false, client = 'eureka';
  while (args.length) {
    const flag = args.shift();
    if (flag === '--origin' && args[0]) origin = args.shift();
    else if (flag === '--output' && args[0]) output = path.resolve(root, args.shift());
    else if (flag === '--development') development = true;
    else if (flag === '--client' && ['codex','claude','eureka','all'].includes(args[0])) client = args.shift();
    else throw new Error('参数无效。使用 --origin <可信 HTTPS 根地址> [--output <目录>] [--development] [--client codex|claude|eureka|all]。');
  }
  if (!origin) throw new Error('必须显式指定 --origin；正式包使用可信 HTTPS 根地址。');
  process.env.NODE_ENV = development ? 'development' : 'production';
  process.env.WEB_ORIGIN = origin;
  const { integrationOrigin } = require('../dist/integrations/public-origin');
  integrationOrigin(); // Validate before any database access.
  const { Test } = require('@nestjs/testing');
  const { AppModule } = require('../dist/app.module');
  const { PluginPackageService } = require('../dist/integrations/plugin-package.service');
  const { prisma } = require('@eureka-atlas/database');
  let module;
  try {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const packages = module.get(PluginPackageService), info = await packages.info(), results = [];
    await fs.mkdir(output, { recursive: true });
    for (const selected of client === 'all' ? ['codex','claude','eureka'] : [client]) {
      const artifact = await packages.archive(selected, info.rules_version);
      if (createHash('sha256').update(artifact.buffer).digest('hex') !== artifact.sha256) throw new Error('ZIP 校验失败。');
      const target = path.join(output, artifact.filename);
      await fs.writeFile(target, artifact.buffer);
      await fs.writeFile(target + '.sha256', artifact.sha256 + '  ' + artifact.filename + '\n');
      results.push({ client:selected,zip: target, sha256: artifact.sha256, rules_version: artifact.rulesVersion, mcp_url: integrationOrigin() + '/api/mcp', development_only: development });
    }
    console.log(JSON.stringify(client === 'all' ? results : results[0], null, 2));
  } finally {
    await module?.close();
    await prisma.$disconnect();
  }
}
main().catch(error => {
  // Do not dump ORM errors, configured prompts, environment or connection strings.
  console.error('Eureka 插件导出失败。请检查构建、可信地址、数据库连接和规则中是否包含凭证。');
  if (error.message.startsWith('必须显式') || error.message.startsWith('参数无效')) console.error(error.message);
  process.exitCode = 1;
});
