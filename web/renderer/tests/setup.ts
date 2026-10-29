// jsdom has no canvas implementation; PixiJS probes for one when imported. Tests only exercise
// pure logic, so report "no context" quietly instead of printing jsdom's not-implemented warning.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
