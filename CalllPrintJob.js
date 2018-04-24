/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/file', 'N/record', 'N/render', 'N/runtime', 'N/search', 'N/https'],
/**
 * @param {file} file
 * @param {record} record
 * @param {render} render
 */
function(file, record, render, runtime, search, url) {

	/**
	 * Definition of the Suitelet script trigger point.
	 * 
	 * @param {Object} context
	 * @param {ServerRequest} context.request - Encapsulation of the incoming request
	 * @param {ServerResponse} context.response - Encapsulation of the Suitelet response
	 * @Since 2015.2
	 */
	function onRequest(context) {
		// get the parameters, record ID's
		var script = runtime.getCurrentScript();
		var templateId = script.getParameter({
			name : 'custscript_pf_xml_template'
		});
		var folderId = script.getParameter({
			name : 'custscript_pf_xml_folder'
		});
		var contractType = script.getParameter({
			name : 'custscript_pf_xml_contract_type'
		});;
		var params = context.request.parameters;
		log.debug('params', params);
		var contract = params.contract;
		var freighContract = params.freightContract;
		var po = params.purchOrd;

		var entityName = ''
		var contractsToPrint = 1;
		var results = 0;
		var custDataSource = [];
		var urlString = url.resolveScript({
			scriptId : 'customscript_print_payliad',
			deploymentId : 'customdeploy_prinid',
			returnExternalUrl : true
		})
		var headers = {
			'Transfer-Encoding' : 'gzip'
		};
		var response = https.post({
			url : urlString,
			headers : headers,
			body : freighContract
		});

		if (contract) {
			var contractFields = search.lookupFields({
				type : 'customrecord_pro_bulk_grain_contract',
				id : contract,
				columns : ['custrecord_pro_bulkcon_estimate', 'name']
			});

			// if it is a contract, then we need to get the correct prices and billing details from the Harvest Allocation record. Add this as a custom data source
			if (contractType == 'vendor') {
				var rs = search.create({
					type : 'customrecord_pro_harvest_allocation',
					columns : ['custrecord_pro_ha_producer', 'custrecord_pro_ha_vendor_address', 'custrecord_pro_ha_producer_cost'],
					filters : [{
						name : 'custrecord_pro_ha_estimate_id',
						operator : 'anyof',
						values : [contractFields.custrecord_pro_bulkcon_estimate[0].value]
					}]
				}).run();
				results = rs.getRange(0, 1000);

				for (var i = 0; i < results.length; i++) {
					custDataSource[i] = {};
					custDataSource[i]['producer'] = results[i].getText({
						name : 'custrecord_pro_ha_producer'
					});
					custDataSource[i]['producer_id'] = results[i].getValue({
						name : 'custrecord_pro_ha_producer'
					});
					custDataSource[i]['billingaddress'] = results[i].getValue({
						name : 'custrecord_pro_ha_vendor_address'
					});
					custDataSource[i]['custrecord_pro_ha_producer_cost'] = results[i].getValue({
						name : 'custrecord_pro_ha_producer_cost'
					});
				}
				if (results && results.length > 1) {
					contractsToPrint = results.length
				}
				log.debug('Vendor custDataSource', custDataSource);

			}

			try {
				var xmlTemplateFile = file.load(templateId);
			} catch (err) {
				throw new Error('No Template', 'Template not set on script deployment, or the file has been.');
			}

			for (var i = 1; i <= contractsToPrint; i++) {
				var renderer = render.create();
				renderer.templateContent = xmlTemplateFile.getContents();
				if (contract) {
					renderer.addRecord('record', record.load({
						type : 'customrecord_pro_bulk_grain_contract',
						id : contract
					}));
				}
				if (freighContract) {
					renderer.addRecord('fc', record.load({
						type : 'customrecord_pro_freight_contract',
						id : freighContract
					}));
				}
				if (po) {
					renderer.addRecord('po', record.load({
						type : 'purchaseorder',
						id : po
					}));
				}
				if (custDataSource.length > 0) {
					renderer.addCustomDataSource({
						format : render.DataSource.OBJECT,
						alias : "ha",
						data : custDataSource[i - 1]
					});
				}
				var invoicePdf = renderer.renderAsPdf();
				if (custDataSource.length > 0) {
					entityName = custDataSource[i - 1].producer ? custDataSource[i - 1].producer : '';
					if (custDataSource[i - 1].producer_id) {
						contractName += '-' + custDataSource[i - 1].producer_id;
					}
				} else {
					if (po) {
						var poFields = search.lookupFields({
							type : 'purchaseorder',
							id : po,
							columns : ['entity']
						});
						entityName = poFields.entity[0].text;

					}
				}

				var contractName = contractFields.name;

				invoicePdf.name = contractName + ' ' + contractType + ' ' + entityName + '.pdf'
				invoicePdf.folder = folderId;
				var fileId = invoicePdf.save();
				// attach to the related documents
				record.attach({
					record : {
						type : 'file',
						id : fileId
					},
					to : {
						type : 'customrecord_pro_bulk_grain_contract',
						id : contract
					}
				});
				if (po) {
					record.attach({
						record : {
							type : 'file',
							id : fileId
						},
						to : {
							type : 'purchaseorder',
							id : po
						}
					})
				}
				if (freighContract) {
					record.attach({
						record : {
							type : 'file',
							id : fileId
						},
						to : {
							type : 'customrecord_pro_freight_contract',
							id : freighContract
						}
					})
				}

				// write the PDF to the response
				context.response.writeFile({
					file : invoicePdf
				})
			}
		}

	}

	return {
		onRequest : onRequest
	};

});
