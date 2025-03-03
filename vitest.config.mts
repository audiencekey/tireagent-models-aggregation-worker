import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.toml' },
				miniflare: {
					kvNamespaces: ["PRODUCTS_AGGREGATION_KV"],
					d1Databases: ["MODELS_AGGREGATION_DB"],
					queueConsumers: ["MODELS_AGGREGATION_FETCH_QUEUE"],
					queueProducers: ["MODELS_AGGREGATION_FETCH_QUEUE"]
				},
			},
		},
	},
});
