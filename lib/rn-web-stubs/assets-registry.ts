/**
 * React Native's asset registry, which is a Metro concept.
 *
 * `react-native-svg` calls `getAssetByID` to turn a `require('./x.png')`
 * number — Metro's representation of a bundled asset — into a URI. The web
 * bundler has no such registry and never produces those numbers: an image
 * on the web is already a URL by the time it reaches a component.
 *
 * So there is nothing to look up, and returning undefined is the correct
 * answer rather than a degraded one. The challenge screen passes no asset
 * ids to SVG at all; this exists so the import graph resolves.
 */
export function getAssetByID(): undefined {
  return undefined;
}
export default { getAssetByID };
