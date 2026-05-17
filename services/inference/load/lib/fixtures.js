import exec from "k6/execution";

const narrativeSeed = normalize(open("../fixtures/narrative.txt"));
const reportSeed = normalize(open("../fixtures/report.txt"));
const seeds = [narrativeSeed, reportSeed];

function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}

function buildText(targetLength, seedOffset) {
  let value = seeds[seedOffset % seeds.length];
  let cursor = seedOffset % seeds.length;

  while (value.length < targetLength) {
    cursor = (cursor + 1) % seeds.length;
    value = `${value}\n\n${seeds[cursor]}`;
  }

  return value.slice(0, targetLength).trim();
}

function createProfile(name, targetLength) {
  return {
    name,
    texts: seeds.map((_, index) => buildText(targetLength, index)),
  };
}

const profiles = {
  short: createProfile("short", 400),
  medium: createProfile("medium", 4000),
  large: createProfile("large", 12000),
  near_limit: createProfile("near_limit", 45000),
};

export const availableTextProfiles = Object.keys(profiles);

export function pickFixture(profileNames) {
  const iteration = exec.scenario.iterationInTest;
  const selectedProfiles = profileNames.map((profileName) => {
    const profile = profiles[profileName];
    if (!profile) {
      throw new Error(`Unknown text profile: ${profileName}`);
    }

    return profile;
  });
  const profile = selectedProfiles[iteration % selectedProfiles.length];
  const text = profile.texts[iteration % profile.texts.length];

  return {
    profile: profile.name,
    text,
    length: text.length,
  };
}
