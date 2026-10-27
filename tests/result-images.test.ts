import test from 'node:test';
import assert from 'node:assert/strict';
import {detachResultImages, resultImageParts} from '../packages/core/src/resultImages.ts';

const image = (url: string, data = 'jpeg-bytes') => ({image: 1, url, type: 'image', mimeType: 'image/jpeg', data, width: 2, height: 1});

test('skill images leave the result text and reach the model as image parts once', () => {
  const result = {post_number: 7, images: [image('https://cdn.example/a.jpeg'), {image: 2, error: 'HTTP 404'}]};
  const detached = detachResultImages(result) as any;
  assert.deepEqual(detached.images, [{image: 1, url: 'https://cdn.example/a.jpeg', mimeType: 'image/jpeg', width: 2, height: 1, attached: 1}, {image: 2, error: 'HTTP 404'}]);
  assert.equal(result.images[0].data, 'jpeg-bytes');
  assert.deepEqual(resultImageParts(detached), [{type: 'text', text: 'Image 1 (https://cdn.example/a.jpeg):'}, {type: 'file-data', data: 'jpeg-bytes', mediaType: 'image/jpeg'}]);
  assert.deepEqual(resultImageParts(detached), []);
});

test('images combined by js_exec code are found inside arrays and settled entries, three at most', () => {
  const reads = Array.from({length: 4}, (_, i) => ({status: 'fulfilled', value: {images: [image(`https://cdn.example/${i}.jpeg`)]}}));
  const detached = detachResultImages({reads, huge: image('https://cdn.example/huge.jpeg', 'x'.repeat(700_000))}) as any;
  assert.deepEqual(detached.reads.map((read: any) => read.value.images[0].attached ?? read.value.images[0].omitted), [1, 2, 3, 'only 3 images are attached per tool call']);
  assert.equal(detached.huge.omitted, 'image data exceeds the model limit');
  assert.equal(resultImageParts(detached).filter(part => part.type === 'file-data').length, 3);
});

test('results without images are returned unchanged', () => {
  const result = {posts: [{post_number: 1, text: 'body'}], other: {type: 'image', mimeType: 'image/svg+xml', data: '<svg/>'}};
  assert.equal(detachResultImages(result), result);
  assert.deepEqual(resultImageParts(result), []);
});
