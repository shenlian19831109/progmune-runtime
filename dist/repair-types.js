"use strict";
/**
 * Repair Candidate Types — P2 Counterfactual Planner Architecture
 *
 * Pluggable search strategies produce RepairCandidates.
 * FeatureExtractor computes CandidateFeatures from each candidate.
 * Ranker scores and ranks candidates by multiple dimensions.
 *
 * This separation enables P3 (manual weights) → P4 (learned Reward Model)
 * without architectural churn.
 */
Object.defineProperty(exports, "__esModule", { value: true });
