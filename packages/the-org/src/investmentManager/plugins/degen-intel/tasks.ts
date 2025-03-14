import { type IAgentRuntime, type UUID, logger } from "@elizaos/core";

import Birdeye from "./providers/birdeye";
import BuySignal from "./providers/buy-signal";
import CoinmarketCap from "./providers/coinmarketcap";
import Twitter from "./providers/twitter";
import TwitterParser from "./providers/twitter-parser";
import type { Sentiment } from "./types";
/**
 * Registers tasks for the agent to perform various Intel-related actions.
 * * @param { IAgentRuntime } runtime - The agent runtime object.
 * @param { UUID } [worldId] - The optional world ID to associate with the tasks.
 * @returns {Promise<void>} - A promise that resolves once tasks are registered.
 */
export const registerTasks = async (runtime: IAgentRuntime, worldId?: UUID) => {
	worldId = runtime.agentId; // this is global data for the agent

	// first, get all tasks with tags "queue", "repeat", "degen_intel" and delete them
	const tasks = await runtime.getTasks({
		tags: ["queue", "repeat", "degen_intel"],
	});

	for (const task of tasks) {
		await runtime.deleteTask(task.id);
	}

	runtime.registerTaskWorker({
		name: "INTEL_BIRDEYE_SYNC_TRENDING",
		validate: async (_runtime, _message, _state) => {
			return true; // TODO: validate after certain time
		},
		execute: async (runtime, _options, task) => {
			const birdeye = new Birdeye(runtime);
			try {
				await birdeye.syncTrendingTokens("solana");
			} catch (error) {
				logger.error("Failed to sync trending tokens", error);
				// kill this task
				runtime.deleteTask(task.id);
			}
		},
	});

	runtime.createTask({
		name: "INTEL_BIRDEYE_SYNC_TRENDING",
		description: "Sync trending tokens from Birdeye",
		worldId,
		metadata: {
			updatedAt: Date.now(),
			updateInterval: 1000 * 60 * 60, // 1 hour
		},
		tags: ["queue", "repeat", "degen_intel"],
	});

	runtime.registerTaskWorker({
		name: "INTEL_COINMARKETCAP_SYNC",
		validate: async (_runtime, _message, _state) => {
			return true; // TODO: validate after certain time
		},
		execute: async (runtime, _options, task) => {
			const cmc = new CoinmarketCap(runtime);
			try {
				await cmc.syncTokens();
			} catch (error) {
				logger.error("Failed to sync tokens", error);
				// kill this task
				await runtime.deleteTask(task.id);
			}
		},
	});

	runtime.createTask({
		name: "INTEL_COINMARKETCAP_SYNC",
		description: "Sync tokens from Coinmarketcap",
		worldId,
		metadata: {
			updatedAt: Date.now(),
			updateInterval: 1000 * 60 * 5, // 5 minutes
		},
		tags: ["queue", "repeat", "degen_intel"],
	});

	runtime.registerTaskWorker({
		name: "INTEL_SYNC_RAW_TWEETS",
		validate: async (runtime, _message, _state) => {
			// Check if Twitter service exists and return false if it doesn't
			const twitterService = runtime.getService("twitter");
			if (!twitterService) {
				// Log only once when we'll be removing the task
				logger.warn("Twitter service not available, removing INTEL_SYNC_RAW_TWEETS task");
				
				// Get all tasks of this type
				const tasks = await runtime.getTasksByName("INTEL_SYNC_RAW_TWEETS");
				
				// Delete all these tasks
				for (const task of tasks) {
					await runtime.deleteTask(task.id);
				}
				
				// Set a flag to indicate we've removed these tasks
				await runtime.setCache("twitter_tasks_removed", true);
				
				return false;
			}
			return true;
		},
		execute: async (runtime, _options, task) => {
			try {
				const twitter = new Twitter(runtime);
				await twitter.syncRawTweets();
			} catch (error) {
				logger.error("Failed to sync raw tweets", error);
			}
		},
	});

	// Create a task to check for Twitter service availability and recreate tasks if needed
	runtime.registerTaskWorker({
		name: "CHECK_TWITTER_SERVICE_AVAILABILITY",
		validate: async () => true, // Always validate
		execute: async (runtime, _options, _task) => {
			const twitterService = runtime.getService("twitter");
			const tasksWereRemoved = await runtime.getCache("twitter_tasks_removed");
			
			// If Twitter service is now available and tasks were previously removed, recreate them
			if (twitterService && tasksWereRemoved) {
				logger.info("Twitter service is now available, recreating Twitter-related tasks");
				
				// Create the tasks
				runtime.createTask({
					name: "INTEL_SYNC_RAW_TWEETS",
					description: "Sync raw tweets from Twitter",
					worldId,
					metadata: {
						updatedAt: Date.now(),
						updateInterval: 1000 * 60 * 15, // 15 minutes
					},
					tags: ["queue", "repeat", "degen_intel"],
				});
				
				runtime.createTask({
					name: "INTEL_PARSE_TWEETS",
					description: "Parse tweets",
					worldId,
					metadata: {
						updatedAt: Date.now(),
						updateInterval: 1000 * 60 * 60 * 24, // 24 hours
					},
					tags: ["queue", "repeat", "degen_intel"],
				});
				
				// Clear the removal flag
				await runtime.setCache("twitter_tasks_removed", false);
			}
		}
	});
	
	// Always create the service checker task
	runtime.createTask({
		name: "CHECK_TWITTER_SERVICE_AVAILABILITY",
		description: "Check if Twitter service is available and recreate tasks if needed",
		worldId,
		metadata: {
			updatedAt: Date.now(),
			updateInterval: 1000 * 60 * 5, // Check every 5 minutes
		},
		tags: ["queue", "repeat", "degen_intel"],
	});

	// Only create the Twitter sync task if the Twitter service exists
	const twitterService = runtime.getService("twitter");
	if (twitterService) {
		// Clear the removal flag since we're creating the tasks
		await runtime.setCache("twitter_tasks_removed", false);
		
		runtime.createTask({
			name: "INTEL_SYNC_RAW_TWEETS",
			description: "Sync raw tweets from Twitter",
			worldId,
			metadata: {
				updatedAt: Date.now(),
				updateInterval: 1000 * 60 * 15, // 15 minutes
			},
			tags: ["queue", "repeat", "degen_intel"],
		});
	} else {
		// Set the flag to indicate tasks haven't been created
		await runtime.setCache("twitter_tasks_removed", true);
		logger.warn("Twitter service not found, skipping creation of INTEL_SYNC_RAW_TWEETS task");
	}

	runtime.registerTaskWorker({
		name: "INTEL_SYNC_WALLET",
		validate: async (_runtime, _message, _state) => {
			return true; // TODO: validate after certain time
		},
		execute: async (runtime, _options, task) => {
			const birdeye = new Birdeye(runtime);
			try {
				await birdeye.syncWallet();
			} catch (error) {
				logger.error("Failed to sync wallet", error);
				// kill this task
				await runtime.deleteTask(task.id);
			}
		},
	});

	runtime.createTask({
		name: "INTEL_SYNC_WALLET",
		description: "Sync wallet from Birdeye",
		worldId,
		metadata: {
			updatedAt: Date.now(),
			updateInterval: 1000 * 60 * 5, // 5 minutes
		},
		tags: ["queue", "repeat", "degen_intel"],
	});

	runtime.registerTaskWorker({
		name: "INTEL_GENERATE_BUY_SIGNAL",
		validate: async (runtime, _message, _state) => {
			// Check if we have some sentiment data before proceeding
			const sentimentsData = await runtime.getCache<Sentiment[]>("sentiments") || [];
			if (sentimentsData.length === 0) {
				logger.warn("No sentiment data available, skipping buy signal generation");
				return false;
			}
			return true;
		},
		execute: async (runtime, _options, task) => {
			const signal = new BuySignal(runtime);
			try {
				await signal.generateSignal();
			} catch (error) {
				logger.error("Failed to generate buy signal", error);
				// Log the error but don't delete the task
			}
		},
	}
);

	runtime.createTask({
		name: "INTEL_GENERATE_BUY_SIGNAL",
		description: "Generate a buy signal",
		worldId,
		metadata: {
			updatedAt: Date.now(),
			updateInterval: 1000 * 60 * 5, // 5 minutes
		},
		tags: ["queue", "repeat", "degen_intel"],
	});

	runtime.registerTaskWorker({
		name: "INTEL_PARSE_TWEETS",
		validate: async (runtime, _message, _state) => {
			// Check if Twitter service exists and return false if it doesn't
			const twitterService = runtime.getService("twitter");
			if (!twitterService) {
				// The main task handler above will take care of removing all Twitter tasks
				return false; // This will prevent execution
			}
			return true;
		},
		execute: async (runtime, _options, task) => {
			const twitterParser = new TwitterParser(runtime);
			try {
				await twitterParser.parseTweets();
			} catch (error) {
				logger.error("Failed to parse tweets", error);
			}
		},
	});

	// Only create the tweet parsing task if the Twitter service exists
	if (twitterService) {
		runtime.createTask({
			name: "INTEL_PARSE_TWEETS",
			description: "Parse tweets",
			worldId,
			metadata: {
				updatedAt: Date.now(),
				updateInterval: 1000 * 60 * 60 * 24, // 24 hours
			},
			tags: ["queue", "repeat", "degen_intel"],
		});
	}
};
