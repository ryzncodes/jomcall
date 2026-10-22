import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCapacity,validatePorts,validateBindings,stopArguments,parseMode} from '../../scripts/local/guard.mjs';
test('capacity and port guard reject unsafe startup',()=>{
 assert.throws(()=>validateCapacity({freeGiB:9,needsPull:true}),/DISK_SPACE/);
 assert.throws(()=>validatePorts({occupied:[54622]}),/PORT_IN_USE/);
 validateCapacity({freeGiB:11,needsPull:true});
});
test('only loopback binds allowed',()=>{
 for(const binding of ['0.0.0.0:54621','[::]:54621',':54621']) assert.throws(()=>validateBindings([binding]),/NON_LOOPBACK/);
 validateBindings(['127.0.0.1:54621','[::1]:54622']);
});
test('stop never deletes volumes or unrelated projects',()=>{
 assert.deepEqual(stopArguments('jomcall-local'),['stop','--project-id','jomcall-local']);
 assert.throws(()=>stopArguments('another-project'),/PROJECT/);
});
test('mode is explicit and defaults to mock',()=>{
 assert.equal(parseMode(), 'mock');assert.equal(parseMode('local'),'local');assert.throws(()=>parseMode('live'),/INVALID_MODE/);
});
test('CLI Docker adapter pins only this project to loopback',async()=>{
 const {pinLoopback}=await import('../../scripts/local/docker-loopback.mjs');
 const p={Labels:{'com.supabase.cli.project':'jomcall-local'},HostConfig:{PortBindings:{'5432/tcp':[{HostIp:'',HostPort:'54622'}]}}};
 assert.equal(pinLoopback(p).HostConfig.PortBindings['5432/tcp'][0].HostIp,'127.0.0.1');
 assert.throws(()=>pinLoopback({Labels:{'com.supabase.cli.project':'photo-ho'}}),/FOREIGN_PROJECT/);
});
