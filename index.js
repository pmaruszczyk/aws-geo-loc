const AWS = require('aws-sdk');

AWS.config.update({region: 'eu-west-1'});

const documentClient = new AWS.DynamoDB.DocumentClient();
const sns = new AWS.SNS({apiVersion: '2010-03-31'});

const createStub = async (userName) => {
    const putParams = {
        TableName: 'geo-loc',
        Item: {
            areas: [],
            locations: [],
            userName: userName,
        }
    };

    await documentClient.put(putParams).promise();
    return putParams;
};

const getUserData = async (userName) => {
    const getParams = {
        TableName: 'geo-loc',
        Key: {
            userName: userName
        }
    };

    let result = await documentClient.get(getParams).promise();

    if (!("Item" in result)) {
        result = await createStub(userName);
    }

    return result.Item;
};

const notifyWatcher = async (area) => {
    const smsParams = {
        Message: area.notification.message,
        PhoneNumber: area.notification.phone,
    };

    try {
        await sns.publish(smsParams).promise();
        console.log("SMS sent: " + JSON.stringify(smsParams));
    }
    catch (e) {
        console.error("Sending SMS failed: " + JSON.stringify(e));
    }
};

const addCurrentLocation = async (userData, location) => {
    let locations = userData.locations;

    locations.unshift(location);
    locations = locations.slice(0, 10);

    const updateParams = {
        TableName: 'geo-loc',
        Key: {
            userName: userData.userName
        },
        UpdateExpression: "set locations = :locations",
        ExpressionAttributeValues: {
            ":locations": locations
        }
    };

    return await documentClient.update(updateParams).promise();
};


const filterToVisitedAreas = (areas, previuosLocation) => {
    return areas.filter(area => locationIsInArea(previuosLocation, area));
};

const filterToLeftAreas = (areas, currentLocation) => {
    return areas.filter(area => !locationIsInArea(currentLocation, area));
};

const locationIsInArea = (location, area) => {
    return area.radius > distanceInKm(location, area);
};

const distanceInKm = (location1, location2) => {
    const earthRadiusInKm = 6371;
    const differenceOfLatitudes = degreesToRadians(location2.latitude - location1.latitude);
    const differenceOfLongitudes = degreesToRadians(location2.longitude - location1.longitude);
    const a =
        Math.sin(differenceOfLatitudes / 2) *
        Math.sin(differenceOfLatitudes / 2) +
        Math.cos(degreesToRadians(location1.latitude)) *
        Math.cos(degreesToRadians(location2.latitude)) *
        Math.sin(differenceOfLongitudes / 2) *
        Math.sin(differenceOfLongitudes / 2);

    const distanceInKm = 2 * earthRadiusInKm * Math.asin(Math.sqrt(a));

    return distanceInKm;
};

const degreesToRadians = (degrees) => {
    return degrees * (Math.PI/180);
};

exports.handler = async (event) => {
    const requestParameters = JSON.parse(event.body);

    const userData = await getUserData(requestParameters.userName);
    const currentLocation = {
        latitude: parseFloat(requestParameters.latitude),
        longitude: parseFloat(requestParameters.longitude),
    };

    if (userData.locations && userData.locations.length) {
        const previousLocation = userData.locations[0];
        const lastVisitedAreas = filterToVisitedAreas(userData.areas, previousLocation);
        const areasLeftByUser = filterToLeftAreas(lastVisitedAreas, currentLocation);
        for (const area of areasLeftByUser) {
            await notifyWatcher(area);
        }
    }

    await addCurrentLocation(userData, currentLocation);

    const response = {
        statusCode: 200,
    };

    return response;
};
